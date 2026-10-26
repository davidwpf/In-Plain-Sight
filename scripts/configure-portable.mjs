import fs from 'node:fs';
fs.mkdirSync('.sites-runtime',{recursive:true});
fs.writeFileSync('.sites-runtime/execution-profile.json',JSON.stringify({executionProfile:'portable'},null,2)+'\n');
console.log('Selected portable development profile.');
