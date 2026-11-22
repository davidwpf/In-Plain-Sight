'use client';
import {useState} from 'react';
import {Check,LoaderCircle} from 'lucide-react';

type Question={id:string;prompt:string};
type Player={id:string;name:string};

export function MostLikelyQuestionCard({data,players,busy,paused,error,onAnswer,onClearError}:{
  data:{question:Question;answerId:string|null};players:Player[];busy:boolean;paused:boolean;error:string;
  onAnswer:(target:string)=>Promise<boolean>;onClearError:()=>void;
}){
  const [choice,setChoice]=useState('');
  return <section className="most-likely-question" aria-label="A question for you">
    <span className="eyebrow">A QUESTION FOR YOU…</span>
    {data.answerId?<>
      <h3>{data.question.prompt}</h3>
      <p className="most-likely-saved"><Check size={18} aria-hidden="true"/> Your answer is saved. The reveal comes with the Court results.</p>
    </>:<form onSubmit={event=>{event.preventDefault();if(choice&&!busy&&!paused)void onAnswer(choice);}}>
      <fieldset disabled={busy||paused} aria-describedby="most-likely-help">
        <legend>{data.question.prompt}</legend>
        <div className="most-likely-choices">{players.map(player=><label key={player.id} className={`most-likely-choice${choice===player.id?' selected':''}`}>
          <input type="radio" name="most-likely-person" value={player.id} checked={choice===player.id} onChange={()=>{setChoice(player.id);onClearError();}}/>
          <span>{player.name}</span>
        </label>)}</div>
      </fieldset>
      <p id="most-likely-help" className="most-likely-help">Just for fun. Answering is optional and has no effect on points.</p>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="button primary full" type="submit" disabled={!choice||busy||paused}>{busy?<><LoaderCircle className="spin" size={17} aria-hidden="true"/> Saving answer</>:'Submit answer'}</button>
      <p className="most-likely-help" role="status">{paused?'The game is paused. You can answer when it resumes.':choice?'Your answer stays private. The reveal comes with the Court results.':'Choose one person, then submit your answer.'}</p>
    </form>}
  </section>;
}

export function MostLikelyResult({result}:{result?:{question:Question;winners:Player[]}|null}){
  if(!result)return null;
  return <section className="most-likely-result" aria-label="Most Likely To result">
    <span className="eyebrow">THE GROUP HAS SPOKEN</span>
    <h3>{result.question.prompt}</h3>
    {result.winners.length>0?<><p>{result.winners.length>1?'A shared title for:':'The title goes to:'}</p><ul>{result.winners.map(player=><li key={player.id}>{player.name}</li>)}</ul></>:<p>No answers this round.</p>}
  </section>;
}
