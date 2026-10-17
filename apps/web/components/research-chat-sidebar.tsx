"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo,useState } from "react";
import { DashboardPrimaryNav } from "./dashboard-primary-nav";
import { GenithmIcon } from "./genithm-icon";
import styles from "./research-chat-sidebar.module.css";

export type ResearchConversationPreview = { id:string;title:string|null;project_id:string;updated_at:string };
type Props = {conversations:ResearchConversationPreview[];projectNames:Record<string,string>;projectCount:number};
export function ResearchChatSidebar({conversations,projectNames,projectCount}:Props) {
  const pathname=usePathname();
  const [search,setSearch]=useState("");
  const [expanded,setExpanded]=useState(false);
  const [mobileOpen,setMobileOpen]=useState(false);
  const filtered=useMemo(()=>conversations.filter(c=>!search.trim()||((c.title??"")+" "+(projectNames[c.project_id]??"")).toLowerCase().includes(search.trim().toLowerCase())),[conversations,projectNames,search]);
  const visible=expanded||search.trim()?filtered:filtered.slice(0,6);
  return <aside className={styles.sidebar} aria-label="Research conversations">
    <Link href="/dashboard/ai" className={styles.newChat} aria-label="Start a new conversation"><GenithmIcon name="plus"/>New chat</Link>
    <button type="button" className={styles.mobileToggle} aria-expanded={mobileOpen} aria-controls="genithm-chat-navigation" onClick={()=>setMobileOpen(!mobileOpen)}><GenithmIcon name="menu"/>Workspace and chats</button>
    <div id="genithm-chat-navigation" className={styles.navigation} data-mobile-open={mobileOpen}>
      <DashboardPrimaryNav />
      <div className={styles.recentHeading}><span>Recent chats</span><Link href="/dashboard/ai/research" aria-label="Open research history">View all</Link></div>
      <label className={styles.searchLabel}><span className={styles.visuallyHidden}>Search conversations</span><input type="search" aria-label="Search conversations" placeholder="Search chats" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <div className={styles.conversations}>{visible.map(c=>{const href="/dashboard/ai/"+c.id;return <Link href={href} key={c.id} className={pathname===href?styles.activeConversation:styles.conversation} aria-current={pathname===href?"page":undefined} title={c.title||"Untitled research conversation"}>
        <GenithmIcon name="chat" size={16}/><span className={styles.conversationInfo}><strong>{c.title?.trim()||"Untitled research conversation"}</strong><small>{projectNames[c.project_id]??"Research project"}</small></span>
      </Link>;})}{!filtered.length?<p className={styles.empty}>{search?"No matching chats.":"Your conversations will appear here."}</p>:null}</div>
      {!search.trim()&&filtered.length>6?<button type="button" className={styles.showMore} onClick={()=>setExpanded(!expanded)}>{expanded?"Show fewer chats":"Show more chats"}</button>:null}
      <p className={styles.projectFoot}>{projectCount} project{projectCount===1?"":"s"} · Private workspace</p>
    </div>
  </aside>;
}
