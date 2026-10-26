import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'In Plain Sight',description:'A social deduction game for 3–30 players. Private roles, murder tasks, voting and new roles each round.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
