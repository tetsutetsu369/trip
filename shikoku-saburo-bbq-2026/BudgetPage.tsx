"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import TripHeader from "@/app/components/TripHeader";

const STORAGE_KEY="trip:shikoku-saburo-bbq-2026:budget:v1";
const rentals=[["テント",1560],["タープ",510],["キャンプテーブル",510],["キャンプチェア",200],["バーベキューコンロ",410],["ガス式コンロ",410],["キャンプライト",100],["炊事用具",620],["毛布",200],["電気延長コード",100]] as const;
const categories=["食費","備品","消耗品","その他"] as const;
type Purchase={id:string;bought:boolean;name:string;category:string;cost:number;note:string};
type Plan={people:number;gasPrice:number;efficiency:number;toll:number;parking:number;kilometers:number[];cottage:number;adventure:number;purchasePerBudget:number;purchases:Purchase[];rentOn:boolean[];rentQty:number[]};
const purchase=(id:string,name:string,category:string):Purchase=>({id,bought:false,name,category,cost:0,note:""});
const initialPlan:Plan={people:4,gasPrice:175,efficiency:18,toll:4000,parking:0,kilometers:[65,65,85,3,135],cottage:12560,adventure:16400,purchasePerBudget:5500,purchases:[purchase("food-bbq","BBQの食材","食費"),purchase("food-breakfast","朝食","食費"),purchase("food-drinks","飲み物・お菓子","食費"),purchase("food-hirome","ひろめ市場での食事","食費"),purchase("supply-fire","炭・着火剤","消耗品"),purchase("supply-tableware","紙皿・割り箸・ゴミ袋","消耗品")],rentOn:rentals.map(()=>false),rentQty:rentals.map(()=>1)};
const money=(v:number)=>new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0}).format(v||0);
const positive=(v:string)=>Math.max(0,Number(v)||0);

export default function BudgetPage(){
  const [plan,setPlan]=useState<Plan>(initialPlan);
  const [savedPlan,setSavedPlan]=useState<Plan|null>(null);
  const [ready,setReady]=useState(false);
  const [savedAt,setSavedAt]=useState("");
  const [saveState,setSaveState]=useState<"loading"|"local"|"saved"|"saving"|"unsaved"|"error">("loading");
  const tripIdRef=useRef<string|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const p=Math.max(1,plan.people);
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      const supabase=createBrowserSupabaseClient();
      try {
        if(supabase){
          const {data:tripId,error:tripError}=await supabase.rpc("get_trip_id_by_slug",{target_slug:"shikoku-saburo-bbq-2026"});
          if(tripError) throw tripError;
          tripIdRef.current=tripId as string;
          const {data,error}=await supabase.from("trip_settings").select("budget").eq("trip_id",tripId).maybeSingle<{budget:Partial<Plan>}>();
          if(error) throw error;
          if(!cancelled&&data?.budget){const restored={...initialPlan,...data.budget};setPlan(restored);setSavedPlan(restored);}
          if(!cancelled) setSaveState(data?"saved":"local");
        } else {
          const saved=localStorage.getItem(STORAGE_KEY);
          if(saved&&!cancelled) setPlan({...initialPlan,...JSON.parse(saved)});
          if(!cancelled) setSaveState("local");
        }
      } catch { if(!cancelled) setSaveState("error"); }
      if(!cancelled) setReady(true);
    };
    void load();
    return ()=>{cancelled=true;};
  },[]);
  useEffect(()=>{if(ready)localStorage.setItem(STORAGE_KEY,JSON.stringify(plan));},[plan,ready]);
  const totals=useMemo(()=>{const km=plan.kilometers.reduce((a,b)=>a+b,0);const gas=km/Math.max(1,plan.efficiency)*plan.gasPrice;const transport=gas+plan.toll+plan.parking;const facility=830*p;const rental=rentals.reduce((s,r,i)=>s+(plan.rentOn[i]?r[1]*plan.rentQty[i]:0),0);const purchaseTotal=plan.purchases.reduce((s,x)=>s+x.cost,0);const purchasePaid=plan.purchases.reduce((s,x)=>s+(x.bought?x.cost:0),0);const purchasePlanned=Math.max(plan.purchasePerBudget*p,purchaseTotal);const purchaseDue=Math.max(0,purchasePlanned-purchasePaid);const unallocated=Math.max(0,purchasePlanned-purchaseTotal);const paid=plan.cottage+plan.adventure+purchasePaid;const day=facility+rental+transport;return{km,gas,transport,facility,rental,purchaseTotal,purchasePaid,purchasePlanned,purchaseDue,unallocated,paid,day,grand:paid+purchaseDue+day};},[plan,p]);
  const update=<K extends keyof Plan>(key:K,value:Plan[K])=>{setPlan(v=>({...v,[key]:value}));setSaveState("unsaved");};
  const saveToDb=async()=>{const supabase=createBrowserSupabaseClient();if(!supabase||!tripIdRef.current){setSaveState("error");return;}setSaveState("saving");const {data:userData}=await supabase.auth.getUser();if(!userData.user){setSaveState("error");return;}const {error}=await supabase.from("trip_settings").upsert({trip_id:tripIdRef.current,budget:plan,updated_by:userData.user.id},{onConflict:"trip_id"});setSaveState(error?"error":"saved");if(!error){setSavedPlan(plan);setSavedAt(new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}));}};
  const setPurchase=(id:string,patch:Partial<Purchase>)=>update("purchases",plan.purchases.map(x=>x.id===id?{...x,...patch}:x));
  const addPurchase=()=>update("purchases",[...plan.purchases,{id:crypto.randomUUID(),bought:false,name:"",category:"備品",cost:0,note:""}]);
  const removePurchase=(id:string)=>update("purchases",plan.purchases.filter(x=>x.id!==id));
  const exportBackup=()=>{const blob=new Blob([JSON.stringify(plan,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="shikoku-saburo-budget-backup.json";a.click();URL.revokeObjectURL(url);};
  const importBackup=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;try{setPlan({...initialPlan,...JSON.parse(await file.text())});}catch{alert("バックアップファイルを読み込めませんでした。");}e.target.value="";};
  const restoreBackup=async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    let restored:Plan;
    try{restored={...initialPlan,...JSON.parse(await file.text())};}
    catch{alert("バックアップファイルを読み込めませんでした。");e.target.value="";return;}
    setPlan(restored);
    setSavedAt(new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}));
    const supabase=createBrowserSupabaseClient();
    if(!supabase||!tripIdRef.current){setSaveState("local");alert("復元しました。DB接続後に保存されます。");e.target.value="";return;}
    setSaveState("saving");
    const {data:userData}=await supabase.auth.getUser();
    if(!userData.user){setSaveState("error");alert("ログイン状態を確認できないため、DBへ保存できませんでした。");e.target.value="";return;}
    const {error}=await supabase.from("trip_settings").upsert({trip_id:tripIdRef.current,budget:restored,updated_by:userData.user.id},{onConflict:"trip_id"});
    setSaveState(error?"error":"saved");
    if(!error)setSavedPlan(restored);
    alert(error?"復元はしましたが、DB保存に失敗しました。":"バックアップを復元し、DBへ保存しました。");
    e.target.value="";
  };
  const reset=()=>{if(confirm("入力内容を初期状態に戻しますか？"))setPlan(initialPlan);};
  const pair=(label:string,total:number,note?:string)=><div className="cost-row"><span>{label}{note&&<small>{note}</small>}</span><b className="num">{money(total)}</b><b className="num">{money(total/p)}</b></div>;
  const saveStatus=saveState==="saved"?"DBに共有保存済み":saveState==="saving"?"DBへ保存中…":saveState==="error"?"DB保存に失敗（端末には保存済み）":"端末保存モード";
  return <main className="budget-shell"><TripHeader tripSlug="shikoku-saburo-bbq-2026" active="budget" showAdmin /><p className="save-status" role="status">{saveState==="unsaved"?"下書きに変更あり・DB未保存":saveStatus}{savedAt&&`｜最終保存 ${savedAt}`}</p>
    <Link className="budget-back" href="/">← ポータルへ戻る</Link>
    <section className="budget-hero"><p className="kicker">COST PLANNER</p><h1>四国三郎の郷 BBQ旅</h1><p>2026年9月4日〜5日｜費用計算</p></section>
    <div className="save-toolbar"><div><strong>下書き（DBへは保存ボタンで反映）</strong><span>{savedAt?"最終DB保存 "+savedAt:savedPlan?"DB保存済み":"DB保存はまだありません"}</span></div><div className="save-actions"><button onClick={saveToDb}>DBへ保存</button><button onClick={exportBackup}>バックアップ</button><button onClick={()=>fileInput.current?.click()}>復元してDBへ保存</button><button className="danger" onClick={reset}>初期化</button></div><input ref={fileInput} hidden type="file" accept="application/json" onChange={restoreBackup}/></div>
    <section className="summary-grid"><Summary label="現在の総計" total={totals.grand} people={p}/><PerPersonSummary total={totals.grand} people={p}/><Summary label="支払済み 合計" total={totals.paid} people={p} tone="paid"/><Summary label="これから必要" total={totals.purchaseDue+totals.day} people={p} tone="due"/></section>
    <h2 className="budget-title">基本設定</h2>
    <div className="panel-grid">
      <section className="panel"><h3>人数・車</h3><div className="fields"><NumberField label="費用を割る人数" value={plan.people} set={v=>update("people",v)} min={1}/><NumberField label="ガソリン単価（円／L）" value={plan.gasPrice} set={v=>update("gasPrice",v)}/><NumberField label="車の実燃費（km／L）" value={plan.efficiency} set={v=>update("efficiency",v)} min={1}/><NumberField label="高速料金" value={plan.toll} set={v=>update("toll",v)}/></div></section>
      <section className="panel"><h3>走行距離</h3>{["フジグラン丸亀 → 四国三郎の郷","四国三郎の郷 → フォレストアドベンチャー祖谷","祖谷 → 高知駅","高知駅 → ひろめ市場","ひろめ市場 → 府中IC"].map((label,i)=><div className="route-row" key={label}><span>{label}</span><input aria-label={label+"の距離"} className="cell-input" type="number" min="0" value={plan.kilometers[i]} onChange={e=>update("kilometers",plan.kilometers.map((x,j)=>j===i?positive(e.target.value):x))}/></div>)}<Total label="概算走行距離" totalText={Math.round(totals.km)+" km"}/></section>
    </div>
    <h2 className="budget-title">支払済みの固定費</h2>
    <div className="panel-grid"><section className="panel"><h3>宿泊費 <span className="tag paid">支払済み</span></h3><Header/>{pair("四国三郎の郷 コテージ",plan.cottage)}<NumberField label="支払済み金額" value={plan.cottage} set={v=>update("cottage",v)}/></section><section className="panel"><h3>アクティビティ費 <span className="tag paid">支払済み</span></h3><Header/>{pair("フォレストアドベンチャー祖谷",plan.adventure)}<NumberField label="支払済み金額" value={plan.adventure} set={v=>update("adventure",v)}/></section></div>
    <h2 className="budget-title">事前に購入するもの</h2><p className="budget-sub">食費・備品・消耗品を同じ予算枠で管理。購入済みのものも、当日までに買うものもここへ追加。</p>
    <section className="panel purchase-panel">
      <div className="purchase-budget-top"><NumberField label="1人当たりの購入予算" value={plan.purchasePerBudget} set={v=>update("purchasePerBudget",v)}/><div className="budget-bars"><div><span>購入予算 合計</span><b>{money(totals.purchasePlanned)}</b></div><div><span>購入済み</span><b>{money(totals.purchasePaid)}</b></div><div><span>残り予算</span><b>{money(totals.purchaseDue)}</b></div></div></div>
      <p className="note">金額は予定額でもOK。購入したら「済」にチェックすると支払済みへ移動する。</p>
      <div className="saved-purchase-summary"><strong>DB保存済みの購入品</strong><span>{savedPlan?.purchases.filter(x=>x.name.trim()).length ? savedPlan.purchases.filter(x=>x.name.trim()).map(x=>`${x.bought?"済":"予定"} ${x.name} ${money(x.cost)}`).join(" ／ ") : "まだ保存されていません"}</span></div>
      <p className="draft-purchase-label">購入品の下書き・編集（「DBへ保存」を押すまで共有されません）</p>
      <div className="purchase-list"><div className="purchase-row purchase-header"><span>済</span><span>購入するもの</span><span>分類</span><span>金額</span><span>メモ</span><span></span></div>{plan.purchases.map(x=><div className="purchase-row" key={x.id}><input className="check" aria-label={x.name+"を購入済みにする"} type="checkbox" checked={x.bought} onChange={e=>setPurchase(x.id,{bought:e.target.checked})}/><input className="cell-input" aria-label="購入品名" placeholder="購入するもの" value={x.name} onChange={e=>setPurchase(x.id,{name:e.target.value})}/><select className="cell-input" aria-label="分類" value={x.category} onChange={e=>setPurchase(x.id,{category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select><input className="cell-input num" aria-label={x.name+"の金額"} type="number" min="0" value={x.cost} onChange={e=>setPurchase(x.id,{cost:positive(e.target.value)})}/><input className="cell-input" aria-label={x.name+"のメモ"} placeholder="数量・店など" value={x.note} onChange={e=>setPurchase(x.id,{note:e.target.value})}/><button className="icon-button" aria-label={x.name+"を削除"} onClick={()=>removePurchase(x.id)}>×</button></div>)}</div>
      <button className="add-button" onClick={addPurchase}>＋ 買うものを追加</button><Header/>{pair("購入品の予定額",totals.purchaseTotal)}{pair("購入済み",totals.purchasePaid)}
    </section>
    <h2 className="budget-title">当日・後日に支払うもの</h2>
    <div className="panel-grid day-grid"><section className="panel"><h3>施設利用費 <span className="tag day">当日</span></h3><Header/>{pair("施設維持費",830*p,"830円 × 人数")}<Total label="施設利用費 合計" total={totals.facility} people={p}/></section><section className="panel"><h3>交通費 <span className="tag day">当日・後日</span></h3><Header/>{pair("ガソリン代",totals.gas)}{pair("高速料金",plan.toll)}{pair("駐車場代",plan.parking)}<NumberField label="駐車場代の見込み" value={plan.parking} set={v=>update("parking",v)}/><Total label="交通費 合計" total={totals.transport} people={p}/></section></div>
    <section className="panel rental-panel"><h3>キャンプ用品レンタル <span className="tag day">当日</span></h3><p className="note">必要なものにチェックして数量を入力。</p><div className="table-wrap"><table className="cost-table"><thead><tr><th>利用</th><th>用品</th><th className="num">単価</th><th className="num">数量</th><th className="num">小計</th><th className="num">1人当たり</th></tr></thead><tbody>{rentals.map((r,i)=>{const sub=plan.rentOn[i]?r[1]*plan.rentQty[i]:0;return <tr key={r[0]}><td><input className="check" aria-label={r[0]+"を利用"} type="checkbox" checked={plan.rentOn[i]} onChange={e=>update("rentOn",plan.rentOn.map((x,j)=>j===i?e.target.checked:x))}/></td><td>{r[0]}</td><td className="num">{money(r[1])}</td><td className="num"><input className="cell-input qty num" aria-label={r[0]+"の数量"} type="number" min="0" value={plan.rentQty[i]} onChange={e=>update("rentQty",plan.rentQty.map((x,j)=>j===i?positive(e.target.value):x))}/></td><td className="num">{money(sub)}</td><td className="num">{money(sub/p)}</td></tr>})}</tbody></table></div><Total label="レンタル 合計" total={totals.rental} people={p}/></section>
    <h2 className="budget-title">最終集計</h2><section className="panel"><Header/>{pair("支払済み",totals.paid)}{pair("事前購入の残額",totals.purchaseDue)}{pair("当日・後日支払い",totals.day)}<Total label="旅行予算 合計" total={totals.grand} people={p}/></section>
    <p className="source-note">施設・レンタル料金は <a href="https://www.mimacamp.jp/price.php" target="_blank" rel="noreferrer">四国三郎の郷 公式料金案内</a>を参考に設定。データはこの端末のブラウザ内に保存されます。</p>
  </main>;
}
function Header(){return <div className="cost-row header"><span>項目</span><span className="num">小計</span><span className="num">1人当たり</span></div>}
function Summary({label,total,people,tone=""}:{label:string;total:number;people:number;tone?:string}){return <div className={"summary-card "+tone}><span>{label}</span><strong>{money(total)}</strong><small>1人当たり {money(total/people)}</small></div>}
function PerPersonSummary({total,people}:{total:number;people:number}){return <div className="summary-card"><span>1人当たりの負担額</span><strong>{money(total/people)}</strong><small>現在の総計 ÷ {people}人</small></div>}
function Total({label,total,people,totalText}:{label:string;total?:number;people?:number;totalText?:string}){return <div className="total-box"><span>{label}{total!==undefined&&people&&<small>1人当たり {money(total/people)}</small>}</span><strong>{totalText??money(total??0)}</strong></div>}
function NumberField({label,value,set,min=0}:{label:string;value:number;set:(n:number)=>void;min?:number}){const id=useId();return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type="number" min={min} value={value} onChange={e=>set(Math.max(min,positive(e.target.value)))}/></div>}
