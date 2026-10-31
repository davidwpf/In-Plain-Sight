import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'In Plain Sight',description:'Kill or be killed. A game of secret killers and suspicious behaviour. Commit a murder or catch a killer.',icons:{icon:'/favicon.svg',apple:[{url:'/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
