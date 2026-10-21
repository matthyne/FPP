"""Recursive-descent Motorola 6805 disassembler (Capstone) that also follows JMP table,X jump tables."""
import capstone,struct,sys,re,collections
md=capstone.Cs(capstone.CS_ARCH_M680X,capstone.CS_MODE_M680X_6805)
md.detail=True
def load(p): return open(p,'rb').read()
def dis1(img,a):
    for i in md.disasm(img[a:a+4],a): return i
    return None
BR=re.compile(r'\$([0-9a-f]{4})$')
def targets(i):
    m=i.mnemonic; ops=i.op_str
    t=[]
    mm=re.findall(r'\$([0-9a-f]{3,4})',ops)
    if m in('jsr','bsr','jmp','bra') or m.startswith('b') and m not in('bset','bclr','bit') or m.startswith('brset') or m.startswith('brclr'):
        if mm and ',x' not in ops: t.append(int(mm[-1],16))
    return t
def walk(img,entries,extra_jt=()):
    code={}; q=list(entries); calls=set(entries); labels=set(entries)
    while q:
        a=q.pop()
        while 0<=a<0x2000 and a not in code:
            i=dis1(img,a)
            if i is None: break
            code[a]=i
            m=i.mnemonic
            for t in targets(i):
                labels.add(t)
                if m in('jsr','bsr'): calls.add(t)
                q.append(t)
            if m in('rts','rti','jmp','bra','swi','stop','wait') : break
            if m=='brn': pass
            a+=i.size
    return code,labels,calls

def walk2(img,entries):
    ents=set(entries); jts={}
    while True:
        code,labels,calls=walk(img,sorted(ents))
        new=False
        for a,i in list(code.items()):
            if i.mnemonic in('jmp','jsr') and ', x' in i.op_str:
                m=re.match(r'(\$?)([0-9a-f]+), x',i.op_str)
                if not m: continue
                b=int(m.group(2),16) if m.group(1) else int(m.group(2))
                if b==0: continue
                k=b; lst=[]
                while k<0x2000 and img[k] in (0xcc,0xcd) :
                    t=img[k+1]<<8|img[k+2]; lst.append(t)
                    if k not in ents: ents.add(k); new=True
                    k+=3
                if img[k]==0x81 and k not in ents: ents.add(k); new=True
                jts[b]=(a,lst)
        if not new: return code,labels,calls,jts
