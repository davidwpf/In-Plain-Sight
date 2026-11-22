type RecentGame={code:string;gameName:string;playerName:string;expiresAt:number;lastOpenedAt:number};
export function RecentGames({games,busy,onOpen}:{games:RecentGame[];busy:boolean;onOpen:(game:RecentGame)=>void}){
  if(!games.length)return null;
  return <section className="recent-games" aria-labelledby="recent-games-heading"><h2 id="recent-games-heading">Recent games</h2><div className="recent-games-list">{games.map(game=><button key={game.code} type="button" className="recent-game" disabled={busy} onClick={()=>onOpen(game)} aria-label={`${game.playerName?'Return as '+game.playerName:'Open game'}: ${game.gameName}`}><span>{game.gameName}</span><small>{game.playerName?'Return as '+game.playerName:'Open game'}</small></button>)}</div><p>Saved on this device. Games expire after seven days.</p></section>;
}
