import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {AppError} from './errors.mjs';
import {gradeSubmission,gradeSummary,problemFingerprint,validateAnswerKey,publicProblem,ASSESSMENT_MODEL,ASSESSMENT_EFFORT} from './assessment.mjs';
const read=(path,fallback)=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):fallback;
const write=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value,null,2));renameSync(path+'.tmp',path);};
export class AssessmentStore {
  constructor(stateDir,{runner}={}){
    this.dir=join(stateDir,'private');this.gradeDir=join(this.dir,'grades');mkdirSync(this.gradeDir,{recursive:true});this.keyFile=join(this.dir,'answer-keys.json');
    this.keys=read(this.keyFile,{drafts:{},problems:{}});this.active=null;this.runner=runner;
  }
  saveDraftKey(id,problem,key){this.keys.drafts[id]={fingerprint:problemFingerprint(problem),key:validateAnswerKey(key,problem.points)};write(this.keyFile,this.keys);}
  attachDraftKey(draftId,problemId){const key=this.keys.drafts[draftId];if(key){this.keys.problems[problemId]=key;write(this.keyFile,this.keys);}return !!key;}
  hasDraftKey(id){return !!this.keys.drafts[id];}
  path(id){if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new AppError('잘못된 시험 ID입니다.');return join(this.gradeDir,`${id}.json`);}
  load(id){const record=read(this.path(id),null);if(record?.status==='running'&&this.active?.id!==id){record.status='failed';record.error='서버 재시작으로 채점이 중단되었습니다. 미완료 문항을 재시도하세요.';write(this.path(id),record);}return record;}
  prepare(session,problems){
    if(session?.status!=='submitted')return null;
    const existing=this.load(session.id);if(existing)return existing;
    const record={sessionId:session.id,status:'queued',phase:'채점 대기',startedAt:null,finishedAt:null,results:[],summary:gradeSummary([],problems),model:ASSESSMENT_MODEL,reasoningEffort:ASSESSMENT_EFFORT,submission:structuredClone(session),problems:problems.map(publicProblem)};
    write(this.path(session.id),record);return record;
  }
  publicResult(session){
    if(session?.status!=='submitted')throw new AppError('정답과 채점 결과는 시험 종료 후에만 볼 수 있습니다.',403);
    const r=this.load(session.id);if(!r)return {status:'queued',results:[],summary:null};
    const {sessionId,status,phase,startedAt,finishedAt,results,summary,model,reasoningEffort,error,current}=r;
    return {sessionId,status,phase,startedAt,finishedAt,results,summary,model,reasoningEffort,error,current};
  }
  retry(session){
    if(session?.status!=='submitted')throw new AppError('시험 종료 후에만 재채점할 수 있습니다.',403);
    const r=this.load(session.id);if(!r||r.status!=='failed'||this.active)throw new AppError('실패한 채점만 재시도할 수 있습니다.',409);
    r.status='queued';r.error=null;r.phase='미완료 문항 채점 대기';write(this.path(session.id),r);return r;
  }
  async run(id){
    if(this.active)return;
    const record=this.load(id);if(record?.status!=='queued')return;
    const controller=new AbortController();this.active={id,controller};record.status='running';record.startedAt??=Date.now();write(this.path(id),record);
    try{
      const result=await gradeSubmission(record.submission,record.problems,{signal:controller.signal,runner:this.runner,previous:record.results,
        getKey:problemId=>this.keys.problems[problemId],
        saveKey:(problemId,key)=>{this.keys.problems[problemId]=key;write(this.keyFile,this.keys);},
        onProgress:progress=>{Object.assign(record,progress);record.summary=gradeSummary(record.results,record.problems);write(this.path(id),record);}
      });
      Object.assign(record,result,{phase:'채점 종료',finishedAt:Date.now()});
    }catch(error){record.status='failed';record.error=error.message;record.finishedAt=Date.now();}
    finally{write(this.path(id),record);this.active=null;}
  }
  stop(){this.active?.controller.abort();}
}
