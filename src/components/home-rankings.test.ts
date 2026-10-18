// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecommendSection } from './douban-section';
import { useAppStore } from '@/lib/store';

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ doubanEnabled: true, recommendSource: 'hot-list' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

function reply(url: string) {
  return Response.json({ items: Array.from({ length: 50 }, (_, i) => ({
    id: String(i), title: `${url.includes('douban_movie_weekly') ? '电影' : '影片'}${i + 1}`,
    cover: '', rating: '8.0',
  })) });
}

async function render(onPick = vi.fn()) {
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client },
      React.createElement(RecommendSection, { onPick })));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}

it('shows six categories together and expands only the selected category, with cards still searchable', async () => {
  vi.stubGlobal('fetch', async (url: string) => reply(url));
  const onPick = vi.fn();
  await render(onPick);
  const sections = Array.from(host.querySelectorAll('section[data-home-category]'));
  expect(sections).toHaveLength(6);
  expect(sections.map(s => s.querySelector('h2')?.textContent)).toEqual([
    '热门电影', '国产剧', '海外剧', '动漫', '综艺', '纪录片',
  ]);
  for (const section of sections) expect(section.querySelectorAll('[role="button"]')).toHaveLength(12);
  const more = Array.from(sections[0].querySelectorAll('button')).find(b => b.textContent?.includes('查看更多'))!;
  await act(async () => more.click());
  expect(sections[0].querySelectorAll('[role="button"]')).toHaveLength(24);
  expect(sections[1].querySelectorAll('[role="button"]')).toHaveLength(12);
  await act(async () => (sections[0].querySelector('[role="button"]') as HTMLElement).click());
  expect(onPick).toHaveBeenCalledWith('电影1');
});

it('keeps successful categories visible when one fails, and retries the failed category', async () => {
  let unavailable = true;
  vi.stubGlobal('fetch', async (url: string) => {
    if (unavailable && url.includes('douban_movie_weekly')) return Response.json({ error: 'upstream down' }, { status: 502 });
    return reply(url);
  });
  await render();
  const movie = host.querySelector('section[data-home-category="movie"]');
  expect(movie?.textContent).toContain('加载失败');
  expect(host.querySelectorAll('section[data-home-category="chinese"] [role="button"]')).toHaveLength(12);
  unavailable = false;
  await act(async () => (movie!.querySelector('button') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(movie!.querySelectorAll('[role="button"]')).toHaveLength(12);
});
