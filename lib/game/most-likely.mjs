import questions from '../../content/most-likely.json' with {type:'json'};

function need(condition,message){if(!condition)throw new Error(message);}
export const MOST_LIKELY_QUESTIONS=questions;
export function validateMostLikelyQuestions(bank=questions){
  need(Array.isArray(bank)&&bank.length>0,'Add at least one Most Likely To question.');
  const ids=new Set(),prompts=new Set();
  for(const question of bank){
    need(typeof question?.id==='string'&&question.id.trim().length>0,'Every Most Likely To question needs an id.');
    need(typeof question.prompt==='string'&&question.prompt.trim().length>0,'Every Most Likely To question needs a prompt.');
    need(!ids.has(question.id),'Most Likely To question ids must be unique.');
    const prompt=question.prompt.trim().toLowerCase();need(!prompts.has(prompt),'Most Likely To questions must be distinct.');
    ids.add(question.id);prompts.add(prompt);
  }
  return true;
}
validateMostLikelyQuestions();

export function privateMostLikely(g,id){
  const state=g.mostLikely;
  if(g.phase!=='playing'||g.active.length<3||!g.active.includes(id)||g.roles[id]!=='faithful'||state?.round!==g.round||!state.question)return undefined;
  return {question:{...state.question},answerId:state.answers?.[id]??null};
}
export function answerMostLikely(g,id,action){
  need(g.phase==='playing','Question answers close when Court opens.');
  need(g.pausedAt===null,'Resume the game before answering the question.');
  need(g.active.includes(id)&&g.roles[id]==='faithful','Only Innocents in this round can answer the question.');
  const state=g.mostLikely;
  need(g.active.length>=3&&state?.round===g.round&&state.question,'There is no question for this round.');
  need(action.round===g.round&&action.questionId===state.question.id,'This question has changed. Check your role again.');
  need(!Object.hasOwn(state.answers??{},id),'Your answer is already saved.');
  need(typeof action.target==='string'&&action.target!==id&&g.active.includes(action.target),'Choose another player from this round.');
  state.answers={...state.answers,[id]:action.target};
}
export function mostLikelyResult(g){
  const state=g.mostLikely;
  if(g.active.length<3||state?.round!==g.round||!state.question)return undefined;
  const counts=new Map();
  for(const [id,target] of Object.entries(state.answers??{})){
    if(!g.active.includes(id)||g.roles[id]!=='faithful'||target===id||!g.active.includes(target))continue;
    counts.set(target,(counts.get(target)??0)+1);
  }
  const highest=Math.max(0,...counts.values());
  return {question:{...state.question},winners:highest?g.active.filter(id=>counts.get(id)===highest).map(id=>({id,name:g.players.find(p=>p.id===id).name})):[]};
}
