import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Message } from '@routerly/shared';
import { TextDiff, diffWords, messageText, promptText } from './TextDiff';

describe('messageText', () => {
  it('returns a plain string content as it is', () => {
    expect(messageText({ role: 'user', content: 'hello' })).toBe('hello');
  });

  it('joins the text parts of a structured content array', () => {
    const m = { role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'image_url' }, { type: 'text', text: 'two' }] } as unknown as Message;
    expect(messageText(m)).toBe('one\ntwo');
  });

  it('returns empty text for content that is neither a string nor an array', () => {
    expect(messageText({ role: 'user', content: null } as unknown as Message)).toBe('');
  });
});

describe('promptText', () => {
  it('prefixes every message with its role', () => {
    expect(promptText([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])).toBe('system: be brief\n\nuser: hi');
  });
});

describe('diffWords', () => {
  it('reports two identical texts as a single unchanged run', () => {
    expect(diffWords('one two three', 'one two three')).toEqual([{ kind: 'same', text: 'one two three' }]);
  });

  it('marks a removed word and keeps what surrounds it', () => {
    const parts = diffWords('keep drop keep', 'keep keep');
    expect(parts.filter(p => p.kind === 'removed').map(p => p.text.trim())).toEqual(['drop']);
    expect(parts.map(p => p.text).join('')).toContain('keep');
  });

  it('marks an added word', () => {
    const parts = diffWords('a c', 'a b c');
    expect(parts.filter(p => p.kind === 'added').map(p => p.text.trim())).toEqual(['b']);
  });

  it('rebuilds the original text from the parts that are not additions', () => {
    const before = 'the quick brown fox jumps over the lazy dog';
    const after = 'the quick fox jumps over the dog';
    const parts = diffWords(before, after);
    expect(parts.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe(before);
    expect(parts.filter(p => p.kind !== 'removed').map(p => p.text).join('')).toBe(after);
  });

  it('handles an empty side', () => {
    expect(diffWords('gone', '')).toEqual([{ kind: 'removed', text: 'gone' }]);
    expect(diffWords('', 'new')).toEqual([{ kind: 'added', text: 'new' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('falls back to one removal plus one addition when the changed region is too large', () => {
    const before = `head ${Array.from({ length: 900 }, (_, i) => `a${i}`).join(' ')} tail`;
    const after = `head ${Array.from({ length: 900 }, (_, i) => `b${i}`).join(' ')} tail`;
    const kinds = diffWords(before, after).map(p => p.kind);
    expect(kinds).toEqual(['same', 'removed', 'added', 'same']);
  });
});

describe('TextDiff', () => {
  it('says so when nothing changed', () => {
    render(<TextDiff before="same text" after="same text" />);
    expect(screen.getByText('This step left the prompt unchanged.')).toBeInTheDocument();
  });

  it('uses the caller label for an unchanged prompt', () => {
    render(<TextDiff before="x" after="x" emptyLabel="Nothing to show" />);
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('renders removals struck through and additions highlighted', () => {
    const { container } = render(<TextDiff before="keep drop" after="keep add" />);
    const removed = Array.from(container.querySelectorAll('span')).find(s => s.textContent === 'drop');
    const added = Array.from(container.querySelectorAll('span')).find(s => s.textContent === 'add');
    expect(removed).toHaveStyle({ textDecoration: 'line-through' });
    expect(added).toBeDefined();
  });
});
