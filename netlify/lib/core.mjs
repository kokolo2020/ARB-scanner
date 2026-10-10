// AUTO-COPIED from the CORE block of index.html (keep in sync). Shared by the page and the simulator.
const QUOTES=['USDT','USDC','BTC','ETH'];
function splitSymbol(s){for(const q of QUOTES){if(s.endsWith(q)&&s.length>q.length)return{base:s.slice(0,-q.length),quote:q};}return null;}
function num(x){const n=parseFloat(x);return isFinite(n)&&n>0?n:null;}
function mk(base,quote,bid,ask,bq,aq){bid=num(bid);ask=num(ask);if(!base||!bid||!ask||!QUOTES.includes(quote))return null;return{base,quote,bid,ask,bidQty:num(bq),askQty:num(aq)};}
const parsers={
  binance(data){const out=[];for(const t of data){const p=splitSymbol(t.symbol);if(!p)continue;const m=mk(p.base,p.quote,t.bidPrice,t.askPrice,t.bidQty,t.askQty);if(m)out.push(m);}return out;},
  kucoin(data){const out=[];for(const t of(data.data&&data.data.ticker)||[]){const[b,q]=String(t.symbol).split('-');const m=mk(b,q,t.buy,t.sell,null,null);if(m)out.push(m);}return out;},
  bybit(data){const out=[];for(const t of(data.result&&data.result.list)||[]){const p=splitSymbol(String(t.symbol));if(!p)continue;const m=mk(p.base,p.quote,t.bid1Price,t.ask1Price,t.bid1Size,t.ask1Size);if(m)out.push(m);}return out;},
  okx(data){const out=[];for(const t of data.data||[]){const[b,q]=String(t.instId).split('-');const m=mk(b,q,t.bidPx,t.askPx,t.bidSz,t.askSz);if(m)out.push(m);}return out;}
};

function triangular(markets,start,fee,cap){
  const g={};
  const add=(from,e)=>{(g[from]||(g[from]=[])).push(e);};
  for(const m of markets){
    const sym=m.base+'/'+m.quote;
    add(m.quote,{to:m.base,rate:1/m.ask,sym,act:'BUY',price:m.ask});
    add(m.base,{to:m.quote,rate:m.bid,sym,act:'SELL',price:m.bid});
  }
  const f=1-fee,res=[];
  for(const e1 of g[start]||[]){
    const A=e1.to;if(A===start)continue;
    for(const e2 of g[A]||[]){
      const B=e2.to;if(B===start||B===A)continue;
      for(const e3 of g[B]||[]){
        if(e3.to!==start)continue;
        const gross=e1.rate*e2.rate*e3.rate-1;
        if(gross>cap)continue;
        const net=(1+gross)*f*f*f-1;
        res.push({key:start+'>'+A+'>'+B,path:start+'→'+A+'→'+B+'→'+start,legs:[e1,e2,e3],gross,net});
      }
    }
  }
  return res;
}

function cross(books,size,fee,transfer,cap){
  const by={};
  for(const ex in books)for(const m of books[ex]){if(m.quote!=='USDT')continue;(by[m.base]||(by[m.base]={}))[ex]=m;}
  const rows=[];let dropped=0;
  for(const base in by){
    const exs=Object.keys(by[base]);if(exs.length<2)continue;
    for(const buy of exs)for(const sell of exs){
      if(buy===sell)continue;
      const a=by[base][buy],b=by[base][sell];
      const gross=b.bid/a.ask-1;
      if(gross>cap){dropped++;continue;}
      const qty=size*(1-fee)/a.ask;
      const profit=qty*b.bid*(1-fee)-size-transfer;
      const net=profit/size;
      const lb=a.askQty?a.askQty*a.ask:null,ls=b.bidQty?b.bidQty*b.bid:null;
      const known=[lb,ls].filter(x=>x!==null);
      rows.push({key:base+':'+buy+'>'+sell,base,buy,sell,buyPx:a.ask,sellPx:b.bid,gross,net,profit,
        liq:known.length?Math.min(...known):null,liqPartial:known.length===1});
    }
  }
  return{rows,dropped};
}
// ---- deep check: order books + recent trades ----
function normBook(ex,d){
  let a,b;
  if(ex==='kucoin'){a=d.data&&d.data.asks;b=d.data&&d.data.bids;}
  else if(ex==='bybit'){a=d.result&&d.result.a;b=d.result&&d.result.b;}
  else if(ex==='okx'){const x=d.data&&d.data[0];a=x&&x.asks;b=x&&x.bids;}
  else{a=d.asks;b=d.bids;}
  const f=l=>(l||[]).map(r=>[+r[0],+r[1]]).filter(r=>r[0]>0&&r[1]>0);
  return{asks:f(a).sort((x,y)=>x[0]-y[0]),bids:f(b).sort((x,y)=>y[0]-x[0])};
}
function normTrades(ex,d){
  let arr=[];
  if(ex==='kucoin')arr=(d.data||[]).map(t=>({ts:Number(t.time)/1e6,price:+t.price}));
  else if(ex==='bybit')arr=((d.result&&d.result.list)||[]).map(t=>({ts:+t.time,price:+t.price}));
  else if(ex==='okx')arr=(d.data||[]).map(t=>({ts:+t.ts,price:+t.px}));
  else arr=(Array.isArray(d)?d:[]).map(t=>({ts:+t.time,price:+t.price}));
  arr=arr.filter(t=>isFinite(t.ts)&&t.price>0);
  if(!arr.length)return null;
  arr.sort((x,y)=>y.ts-x.ts);
  return{last:arr[0],count:arr.length};
}
function walkBuy(asks,spend){
  let rem=spend,qty=0;
  for(const[p,q]of asks){const cost=p*q;if(rem>=cost){qty+=q;rem-=cost;}else{qty+=rem/p;rem=0;break;}}
  return{qty,spent:spend-rem,full:rem<=spend*1e-9};
}
function walkSell(bids,qty){
  let rem=qty,got=0;
  for(const[p,q]of bids){if(rem>=q){got+=p*q;rem-=q;}else{got+=p*rem;rem=0;break;}}
  return{proceeds:got,sold:qty-rem,full:rem<=qty*1e-9};
}
function evalSize(buyBook,sellBook,size,fee,transfer){
  const b=walkBuy(buyBook.asks,size*(1-fee));
  if(!b.full)return{ok:false,reason:'buy-depth',fillable:b.spent/(1-fee)};
  const s=walkSell(sellBook.bids,b.qty);
  if(!s.full)return{ok:false,reason:'sell-depth',fillable:size*(s.sold/b.qty)};
  const profit=s.proceeds*(1-fee)-size-transfer;
  return{ok:true,profit,net:profit/size,buyAvg:size*(1-fee)/b.qty,sellAvg:s.proceeds/b.qty};
}
const GRID=[25,50,100,250,500,1000,2500,5000,10000];
function bestSize(buyBook,sellBook,fee,transfer,sizeWanted){
  const atSize=evalSize(buyBook,sellBook,sizeWanted,fee,transfer);
  let best=null;
  for(const s of GRID){
    const r=evalSize(buyBook,sellBook,s,fee,transfer);
    if(!r.ok)break;
    if(r.profit>0&&(!best||r.profit>best.profit))best={size:s,profit:r.profit,net:r.net};
  }
  return{atSize,best};
}
function staleInfo(t,mid,now){
  if(!t)return{age:null,dev:null,stale:true};
  const age=(now-t.last.ts)/1000;
  const dev=mid>0?Math.abs(t.last.price-mid)/mid:null;
  return{age,dev,stale:age>300||(dev!==null&&dev>0.01)};
}
function verifyRow(bb,sb,bt,st,size,fee,transfer,now){
  const{atSize,best}=bestSize(bb,sb,fee,transfer,size);
  const mid=bk=>(bk.asks[0][0]+bk.bids[0][0])/2;
  const buyT=staleInfo(bt,mid(bb),now),sellT=staleInfo(st,mid(sb),now);
  const stale=buyT.stale||sellT.stale;
  let verdict;
  if(atSize.ok&&atSize.profit>0&&!stale)verdict='REAL';
  else if(best&&!stale)verdict='SMALL';
  else if(stale)verdict='STALE';
  else verdict='NO';
  return{atSize,best,buyT,sellT,verdict};
}
export { splitSymbol, parsers, triangular, cross, normBook, normTrades, walkBuy, walkSell, evalSize, bestSize, staleInfo, verifyRow };
