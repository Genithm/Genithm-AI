"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import styles from "./research-chat-sidebar.module.css";

export type ResearchConversationPreview = {
  id: string;
  title: string | null;
  project_id: string;
  updated_at: string;
};

type Props = {
  conversations: ResearchConversationPreview[];
  projectNames: Record<string,string>;
  projectCount: number;
};

export function ResearchChatSidebar({ conversations, projectNames, projectCount }: Props) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return conversations.filter((conversation) =>
      !needle || (conversation.title ?? "").toLocaleLowerCase().includes(needle) ||
      (projectNames[conversation.project_id] ?? "").toLocaleLowerCase().includes(needle)
    );
  }, [conversations, projectNames, search]);

  return (
    <aside className={styles.sidebar} aria-label="Research conversations">
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">G</span>
        <div><strong>Genithm</strong><span>Bioinformatics AI</span></div>
      </div>

      <Link href="/dashboard/ai" className={styles.newChat} aria-label="Start a new conversation">
        <span aria-hidden="true">＋</span> New conversation
      </Link>

      <label className={styles.searchLabel}>
        <span className={styles.searchIcon} aria-hidden="true">⌕</span>
        <span className={styles.visuallyHidden}>Search conversations</span>
        <input type="search" aria-label="Search conversations" placeholder="Search chats" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>

      <div className={styles.groupHeading}>Recent chats <span>{filtered.length}</span></div>
      <div className={styles.conversations}>
        {filtered.map((conversation) => {
          const href = "/dashboard/ai/" + conversation.id;
          const active = pathname === href;
          return (
            <Link href={href} key={conversation.id}
              className={active ? styles.activeConversation : styles.conversation}
              aria-current={active ? "page" : undefined}
              title={conversation.title || "Untitled research conversation"}>
              <span className={styles.conversationIcon} aria-hidden="true">✳</span>
              <span className={styles.conversationInfo}>
                <strong>{conversation.title?.trim() || "Untitled research conversation"}</strong>
                <small>{projectNames[conversation.project_id] ?? "Research project"}</small>
              </span>
            </Link>
          );
        })}
        {!filtered.length ? (
          <p className={styles.empty}>{search ? "No matching chats." :
            "Your research conversations will appear here."}</p>
        ) : null}
      </div>

      <nav className={styles.bottomNav} aria-label="Research workspace shortcuts">
        <Link href="/dashboard/ai/research"><span aria-hidden="true">▤</span> Research history</Link>
        <Link href="/dashboard/tools"><span aria-hidden="true">⚙</span> Scientific tools</Link>
        <Link href="/dashboard/dossiers"><span aria-hidden="true">◈</span> Evidence dossiers</Link>
        <Link href="/dashboard/reports"><span aria-hidden="true">▧</span> Reports</Link>
      </nav>
      <div className={styles.projectFoot}>
        <span className={styles.statusDot} aria-hidden="true" />
        {projectCount} research project{projectCount === 1 ? "" : "s"} · Private workspace
      </div>
    </aside>
  );
}
