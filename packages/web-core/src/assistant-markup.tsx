import { Fragment, type ReactNode } from 'react';

/**
 * The small markup the assistant is allowed to write (ADR-0107): paragraphs, "-" bullets,
 * "1." steps, **bold** and `code`. Rendered as React elements, never as HTML, so nothing the
 * model (or a lookup result it quotes) writes can reach the DOM as markup.
 */
type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'steps'; start: number; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const STEP = /^\s*(\d+)[.)]\s+(.*)$/;
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

export function parseAssistantMarkup(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    const step = STEP.exec(line);
    if (bullet) {
      if (current?.kind !== 'bullets') {
        flush();
        current = { kind: 'bullets', items: [] };
      }
      current.items.push(bullet[1]!);
    } else if (step) {
      if (current?.kind !== 'steps') {
        flush();
        current = { kind: 'steps', start: Number(step[1]), items: [] };
      }
      current.items.push(step[2]!);
    } else if (current && current.kind !== 'paragraph' && /^\s{2,}/.test(raw)) {
      // An indented line continues the previous list item.
      const items = current.items;
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else {
      if (current?.kind !== 'paragraph') {
        flush();
        current = { kind: 'paragraph', lines: [] };
      }
      // A heading marker is shown as plain text: the assistant is told not to use them.
      current.lines.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flush();
  return blocks;
}

/** **bold** and `code` inside one line; everything else is text. */
export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={i} dir="ltr" className="rounded bg-surface-muted px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function AssistantMarkup({ text }: { text: string }) {
  const blocks = parseAssistantMarkup(text);
  return (
    <div className="space-y-2 [&_li]:ps-1">
      {blocks.map((b, i) => {
        if (b.kind === 'bullets')
          return (
            <ul key={i} className="list-disc space-y-1 ps-5">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        if (b.kind === 'steps')
          return (
            <ol key={i} start={b.start} className="list-decimal space-y-1 ps-5">
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
