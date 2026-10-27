import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'In Plain Sight',description:'Kill or be killed. A game of secret killers and suspicious behaviour. Commit a murder or catch a killer.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
