"""Annotated 68HC05 listing generator for the FM900 master EPROMs.
Usage: python3 tools/mklist.py FM92R|FM92L   (writes firmware/<name>.lst)"""
import sys,collections,re,json,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
HERE=os.path.dirname(os.path.abspath(__file__))
FWDIR=os.path.dirname(HERE)
MASTERS=os.path.join(os.path.dirname(FWDIR),'fm900','MASTERS')
from d6805 import *
def build(name, syms=None, comments=None, out=None):
    syms=syms or {}; comments=comments or {}
    img=load(os.path.join(MASTERS,'%s.BIN'%name))
    vec=[struct.unpack('>H',img[i:i+2])[0] for i in range(0x1ff4,0x2000,2)]
    code,labels,calls,jts=walk2(img,[v for v in set(vec) if v])
    xref=collections.defaultdict(list)
    for a,i in code.items():
        for t in targets(i): xref[t].append(a)
    for b,(a,lst) in jts.items():
        for t in lst: xref[t].append(b); calls.add(t) if False else None; labels.add(t)
    def lab(t):
        if t in syms: return syms[t]
        if t in calls: return 'sub_%04x'%t
        return 'L_%04x'%t
    def ramname(v):
        return syms.get(v)
    cov=bytearray(0x2000)
    for a,i in code.items():
        for k in range(i.size): cov[a+k]=1
    lines=[]
    a=0
    while a<0x2000:
        if a in code:
            i=code[a]
            if a in labels or a in calls:
                lines.append('')
                xr=sorted(set(xref.get(a,[])))
                lines.append('%s:%s'%(lab(a),('    ; xref '+' '.join('%04x'%x for x in xr[:12])+(' ...' if len(xr)>12 else '')) if xr else ''))
            op=i.op_str
            # substitute branch targets
            ts=targets(i)
            if ts:
                op=re.sub(r'\$%04x$'%ts[-1],lab(ts[-1]),op)
            m=re.match(r'(\d+), x$',op)
            if m: op='$%04x, x'%int(m.group(1))
            def rsub(m):
                v=int(m.group(1),16); n=syms.get(v)
                return (n if n else m.group(0))
            op=re.sub(r'\$([0-9a-f]{2})\b(?!\w)',rsub,op) if not ts or i.mnemonic.startswith(('brset','brclr')) else op
            if i.mnemonic.startswith(('brset','brclr')):
                pass
            op=re.sub(r'#(-?\d+)',lambda m:'#$%02x'%(int(m.group(1))&0xff),op)
            cm=comments.get(a,'')
            lines.append('  %04x  %-8s %-6s %-28s%s'%(a,i.bytes.hex(),i.mnemonic,op,('; '+cm) if cm else ''))
            a+=i.size
        else:
            b=a
            while b<0x2000 and b not in code: b+=1
            seg=img[a:b]
            if any(seg):
                if a in labels: lines.append('\n%s:'%lab(a))
                for k in range(a,b,16):
                    chunk=img[k:min(b,k+16)]
                    if any(chunk) or k==a:
                        cm=comments.get(k,'')
                        lines.append('  %04x  db %s%s'%(k,chunk.hex(' '),('   ; '+cm) if cm else ''))
            a=b
    txt='\n'.join(lines)
    if out: open(out,'w').write(txt)
    return txt,code,calls,xref,jts
if __name__=='__main__':
    n=sys.argv[1]
    sy={}; cm={}
    ann=os.path.join(FWDIR,n+'.ann')
    if os.path.exists(ann):
        for l in open(ann):
            l=l.rstrip('\n')
            if not l.strip() or l.startswith('#'): continue
            k,_,v=l.partition(' ')
            if k.startswith('='): sy[int(k[1:],16)]=v.strip()
            else: cm[int(k,16)]=v.strip()
    build(n,sy,cm,os.path.join(FWDIR,n+'.lst'))
