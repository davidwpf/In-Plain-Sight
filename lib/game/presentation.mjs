// Role keys stay compatible with Games already saved and clients still open.
export function roleLabel(role){
  if(role==='traitor'||role==='killer')return 'Killer';
  return role==='faithful'?'Faithful':'Player';
}
// Translate recorded system explanations without changing scores or player names.
export function roleWording(text=''){
  return String(text??'').replace(/\btraitors?\b/gi,word=>{
    const label=word.toLowerCase()==='traitors'?'killers':'killer';
    if(word===word.toUpperCase())return label.toUpperCase();
    return word[0]===word[0].toUpperCase()?label[0].toUpperCase()+label.slice(1):label;
  });
}
