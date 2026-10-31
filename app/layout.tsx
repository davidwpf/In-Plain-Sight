import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'In Plain Sight',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'In Plain Sight',statusBarStyle:'default'},description:'A small favour could hide a secret murder. A social deduction game of everyday actions and suspicious intentions, where Killers carry out secret tasks and Innocents try to spot them. Play with friends and family at a get-together, over an evening or across a weekend.',icons:{icon:'/favicon.svg?v=4',apple:[{url:'/apple-touch-icon.png?v=4',sizes:'180x180',type:'image/png'}]}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
