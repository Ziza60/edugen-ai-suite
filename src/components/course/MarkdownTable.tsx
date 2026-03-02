import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface MarkdownTableProps {
  children: React.ReactNode;
}

// Desktop: styled HTML table with pedagogical design
function StyledTable({ children }: MarkdownTableProps) {
  return (
    <div className="my-6 w-full overflow-x-auto rounded-xl border border-border/60 shadow-sm">
      <table className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

function StyledThead({ children }: MarkdownTableProps) {
  return (
    <thead className="bg-primary/8 dark:bg-primary/15 border-b-2 border-primary/20">
      {children}
    </thead>
  );
}

function StyledTh({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-primary dark:text-primary/90"
      {...props}
    >
      {children}
    </th>
  );
}

function StyledTr({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className="border-b border-border/40 transition-colors hover:bg-muted/40 even:bg-muted/20"
      {...props}
    >
      {children}
    </tr>
  );
}

function StyledTd({ children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  // Check if this is the first column (aspect column) by checking if it's the first td
  const isFirstCol = props.style?.fontWeight === "bold" || false;

  return (
    <td
      className={cn(
        "px-4 py-3 text-sm leading-relaxed",
        "first:font-medium first:text-foreground first:bg-muted/30 first:border-r first:border-border/30",
        "first:min-w-[140px] first:max-w-[200px]"
      )}
      {...props}
    >
      {children}
    </td>
  );
}

// Mobile: card-based layout
function MobileCardTable({ children }: MarkdownTableProps) {
  // Extract headers and rows from children
  const headers: string[] = [];
  const rows: string[][] = [];

  React.Children.forEach(children, (child: any) => {
    if (!child?.props?.children) return;
    const tag = child.type;

    if (tag === "thead" || tag === StyledThead) {
      React.Children.forEach(child.props.children, (tr: any) => {
        React.Children.forEach(tr?.props?.children, (th: any) => {
          headers.push(extractText(th?.props?.children));
        });
      });
    }

    if (tag === "tbody") {
      React.Children.forEach(child.props.children, (tr: any) => {
        const row: string[] = [];
        React.Children.forEach(tr?.props?.children, (td: any) => {
          row.push(extractText(td?.props?.children));
        });
        rows.push(row);
      });
    }
  });

  if (headers.length === 0 || rows.length === 0) {
    // Fallback to scroll table
    return (
      <div className="my-6 w-full overflow-x-auto rounded-xl border border-border/60 shadow-sm">
        <table className="w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    );
  }

  return (
    <div className="my-6 space-y-3">
      {rows.map((row, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-2"
        >
          {row.map((cell, j) => (
            <div key={j} className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/70">
                {headers[j] || `Col ${j + 1}`}
              </span>
              <span className="text-sm text-foreground leading-relaxed">{cell}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function extractText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children) return extractText(node.props.children);
  return "";
}

// Export markdown component overrides
export function useMarkdownTableComponents() {
  const isMobile = useIsMobile();

  return {
    table: ({ children, ...props }: any) =>
      isMobile ? (
        <MobileCardTable>{children}</MobileCardTable>
      ) : (
        <StyledTable>{children}</StyledTable>
      ),
    thead: ({ children, ...props }: any) => <StyledThead>{children}</StyledThead>,
    th: ({ children, ...props }: any) => <StyledTh {...props}>{children}</StyledTh>,
    tr: ({ children, ...props }: any) => <StyledTr {...props}>{children}</StyledTr>,
    td: ({ children, ...props }: any) => <StyledTd {...props}>{children}</StyledTd>,
  };
}
