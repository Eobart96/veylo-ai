// Audit only Git candidates; never print matched secrets or inspect ignored data.
import {execFileSync} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean))];
const issues=[];let bytes=0;
const secrets=[/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{20,}/,/\bgithub_pat_[A-Za-z0-9_]{25,}/,/\bsk-[A-Za-z0-9_-]{24,}/,/\bAKIA[A-Z0-9]{16}/];
for(const file of files){
  if(/(^|\/)(?:node_modules|target|dist|\.cache|\.tools|\.unlazy|\.git|local-history|del|_git-package)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:log|exe|msi|pdb|zip|db|sqlite3?|pem|pfx)$/i.test(file)){issues.push({file,reason:'forbidden-path'});continue;}
  const size=statSync(path.join(root,file)).size;bytes+=size;
  if(size>2*1024*1024){issues.push({file,reason:'large-file'});continue;}
  if(/\.(?:png|ico|bgra)$/.test(file))continue;
  const text=readFileSync(path.join(root,file),'utf8');
  if(secrets.some(pattern=>pattern.test(text)))issues.push({file,reason:'credential-signature'});
  if(/[C-Z]:[\\/]Users[\\/][^\s"'<>]+|E:[\\/]Sync[\\/]/.test(text))issues.push({file,reason:'personal-absolute-path'});
}
if(!files.length)issues.push({reason:'empty-candidate'});
if(issues.length){console.error(JSON.stringify({issues},null,2));process.exit(1);}
console.log('GIT_CANDIDATE_AUDIT_OK',JSON.stringify({files:files.length,bytes}));
