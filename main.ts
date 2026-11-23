// One-file stack VM for the tiny-stack ISA v1 (bounty tiny-stack-vm-01):
// runs every program in the input dir on its input and writes stdout.bin
// + exit.txt per instance. No secrets, no dependencies.
import{mkdirSync,readdirSync,readFileSync,writeFileSync}from'node:fs';
import{join}from'node:path';
const I=process.env.MAKEFUN_INPUT_DIR??'/input',O=process.env.MAKEFUN_OUTPUT_DIR??'/output';
// Opcode facts packed per byte: bits 0-2 immediate length, bits 3-4 pops,
// bits 5-6 pushes, bit 7 set when the byte is a real opcode at all.
const T=new Uint8Array(84),d=(o,i,p,u)=>{T[o]=i|p<<3|u<<5|128};
d(0,0,0,0);d(1,1,0,1);d(2,4,0,1);d(3,0,1,0);d(4,0,1,2);d(5,0,2,2);d(6,0,2,3);d(7,0,3,3);
for(let o=16;o<35;o++)d(o,0,2,1); // binary block; NEG and NOT override below
d(23,0,1,1);d(27,0,1,1);
d(48,2,0,0);d(49,2,1,0);d(50,2,1,0);d(51,2,0,0);d(52,0,0,0);
d(64,0,1,1);d(65,0,2,0);d(80,0,1,0);d(81,0,1,0);d(82,0,0,1);d(83,0,1,0);
// Runs one program (g) on one input (t); returns [output bytes, exit code].
// A trap ends the run at once: its code becomes the exit code and the
// output written so far is kept.
function run(g,t){
const n=g.length,S=new Int32Array(256),K=new Int32Array(64),M=new Int32Array(256),u=new Uint8Array(65536);
let s=0,k=0,l=0,i=0,p=0,e=0;
const f=c=>[u.subarray(0,l),c];
for(;;){
if(e>999999)return f(10); // step limit
if(p<0||p>=n)return f(9); // pc outside the program
const o=g[p],w=T[o];
if(!w)return f(5); // unknown opcode
const m=w&7,pp=w>>3&3,pu=w>>5&3;
if(p+m>=n)return f(9); // immediate cut off
e++;
const x=p+1+m;
if(s<pp)return f(2); // stack underflow
if(s-pp+pu>256)return f(3); // stack overflow
p=x;
switch(o){
case 0:return f(0); // HALT
case 1:S[s++]=(g[x-1]<<24)>>24;break; // PUSH8, sign-extended
case 2:S[s++]=g[x-4]|g[x-3]<<8|g[x-2]<<16|g[x-1]<<24;break; // PUSH32
case 3:s--;break; // POP
case 4:S[s]=S[s-1];s++;break; // DUP
case 5:{const v=S[s-1];S[s-1]=S[s-2];S[s-2]=v;break;} // SWAP
case 6:S[s]=S[s-2];s++;break; // OVER
case 7:{const v=S[s-3];S[s-3]=S[s-2];S[s-2]=S[s-1];S[s-1]=v;break;} // ROT
case 23:S[s-1]=-S[s-1]|0;break; // NEG, wrapping
case 27:S[s-1]=~S[s-1];break; // NOT
case 16:case 17:case 18:case 19:case 20:case 21:case 22:case 24:case 25:case 26:
case 28:case 29:case 30:case 32:case 33:case 34:{
const b=S[s-1],a=S[s-2];let r;
if(o<18)r=o==16?(a+b)|0:(a-b)|0; // ADD, SUB
else if(o==18)r=Math.imul(a,b); // MUL, low 32 bits of the exact product
else if(o<23){if(!b)return f(4); // DIV, MOD, DIVU, MODU share the zero check
r=o==19?(a==-2147483648&&b==-1?a:(a/b)|0):o==20?(b==-1?0:a%b|0):o==21?Math.floor((a>>>0)/(b>>>0))|0:(a>>>0)%(b>>>0)|0;}
else if(o<27)r=o==24?a&b:o==25?a|b:a^b; // AND, OR, XOR
else if(o<31)r=o==28?a<<(b&31):o==29?a>>(b&31):(a>>>(b&31))|0; // SHL, SHR, SHRU
else r=o==32?a==b?1:0:o==33?a<b?1:0:(a>>>0)<(b>>>0)?1:0; // EQ, LT, LTU
S[s-2]=r;s--;break;}
case 48:case 49:case 50:{ // JMP, JZ, JNZ, offset from the next instruction
const r=(g[x-2]|g[x-1]<<8)<<16>>16;let q=o==48;
if(!q){const v=S[--s];q=o==49?v==0:v!=0;}
if(q)p=x+r;break;}
case 51:if(k>63)return f(7);K[k++]=x;p=g[x-2]|g[x-1]<<8;break; // CALL
case 52:if(!k)return f(8);p=K[--k];break; // RET
case 64:{const a=S[s-1];if(a<0||a>255)return f(6);S[s-1]=M[a];break;} // LOAD
case 65:{const a=S[s-1];if(a<0||a>255)return f(6);M[a]=S[s-2];s-=2;break;} // STORE
case 80:{const v=''+S[s-1];if(l+v.length>65536)return f(11);s--; // PRINT, decimal
for(let j=0;j<v.length;j++)u[l++]=v.charCodeAt(j);break;}
case 81:if(l>65535)return f(11);u[l++]=S[--s]&255;break; // PUTC, low byte
case 82:S[s++]=i<t.length?t[i++]:-1;break; // IN, -1 past the end
case 83:return f(S[--s]&255); // EXIT, low byte
}}}
for(const id of readdirSync(I).sort()){
let g;try{g=readFileSync(join(I,id,'program.bin'));}catch{continue;}
const[out,c]=run(g,readFileSync(join(I,id,'input.bin')));
mkdirSync(join(O,id),{recursive:true});
writeFileSync(join(O,id,'stdout.bin'),out);
writeFileSync(join(O,id,'exit.txt'),c+'\n');
}
