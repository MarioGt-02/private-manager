import { createRoot } from "react-dom/client";
import { Board } from "@/components/board/Board";
import { fixture } from "./ui-actions";
const original=fixture.objects[0];
const categories=["Informatica","Macchina","Legname","Sport","Elettrico",null];
fixture.objects=categories.map((category,index)=>({...structuredClone(original),id:index?`category-${index}`:original.id,title:index===0?"多语言标题 — 创建完整的个人工作空间 ".repeat(5):`${category??"New Object"} · Complete outcome`,status:"ready",category,currentState:"Imported from Kanban Tool.\n\n"+"保留完整历史描述，只在卡片中显示摘要预览。 ".repeat(30),nextAction:"先确认安装位置，再记录需要准备的配件。 ".repeat(8),checklist:index?original.checklist.slice(0,3):[]}));
createRoot(document.getElementById("root")!).render(<Board initialObjects={structuredClone(fixture.objects)} />);
