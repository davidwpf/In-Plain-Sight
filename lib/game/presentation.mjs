// Role keys stay compatible with Games already saved and clients still open.
export function roleLabel(role){
  if(role==='traitor'||role==='killer')return 'Killer';
  return role==='faithful'||role==='innocent'?'Innocent':'Player';
}
// Translate recorded system explanations without changing scores or player names.
export function roleWording(text=''){
  return String(text??'').replace(/\b(traitors?|faithfuls?)\b/gi,word=>{
    const label=word.toLowerCase().startsWith('faithful')?(word.toLowerCase()==='faithfuls'?'innocents':'innocent'):(word.toLowerCase()==='traitors'?'killers':'killer');
    if(word===word.toUpperCase())return label.toUpperCase();
    return word[0]===word[0].toUpperCase()?label[0].toUpperCase()+label.slice(1):label;
  }).replace(/\ba innocent\b/gi,phrase=>phrase===phrase.toUpperCase()?'AN INNOCENT':phrase[0]==='A'?'An innocent':'an innocent');
}
