import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAssistantThread } from './assistant.js';

describe('useAssistantThread', () => {
  it('keeps the id across turns, gives a new one on a new chat, and notes when the user acted', () => {
    const { result } = renderHook(() => useAssistantThread());
    const id = result.current.conversationId;
    expect(result.current.untouched).toBe(true);
    act(() => result.current.setThread([{ role: 'user', content: 'كم سعر الحليب؟' }]));
    expect(result.current.conversationId).toBe(id);
    expect(result.current.untouched).toBe(false);
    act(() => result.current.startNew());
    expect(result.current.conversationId).not.toBe(id);
    expect(result.current.thread).toEqual([]);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows a past conversation under its own id', () => {
    const { result } = renderHook(() => useAssistantThread());
    act(() =>
      result.current.load('0190a000-0000-7000-8000-0000000000c1', [{ role: 'user', content: 'q' }]),
    );
    expect(result.current.conversationId).toBe('0190a000-0000-7000-8000-0000000000c1');
    expect(result.current.thread).toHaveLength(1);
    expect(result.current.untouched).toBe(false);
  });
});
