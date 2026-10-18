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

async function choose(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!;
  await act(async () => button.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}

it('shows one category at a time with the original category controls, preserving search and expansion', async () => {
  vi.stubGlobal('fetch', async (url: string) => reply(url));
  const onPick = vi.fn();
  await render(onPick);
  const sections = Array.from(host.querySelectorAll('section[data-home-category]'));
  expect(sections).toHaveLength(1);
  expect(Array.from(host.querySelectorAll('button[aria-pressed]')).map(b => b.textContent)).toEqual([
    '电影周榜', '国产剧周榜', '海外剧周榜', '国内综艺', '海外综艺', '百度热播剧', '动漫', '纪录片',
  ]);
  for (const section of sections) expect(section.querySelectorAll('[role="button"]')).toHaveLength(12);
  const more = Array.from(sections[0].querySelectorAll('button')).find(b => b.textContent?.includes('查看更多'))!;
  await act(async () => more.click());
  expect(sections[0].querySelectorAll('[role="button"]')).toHaveLength(24);
  await act(async () => (sections[0].querySelector('[role="button"]') as HTMLElement).click());
  expect(onPick).toHaveBeenCalledWith('电影1');
  await choose('动漫');
  expect(host.querySelectorAll('section[data-home-category]')).toHaveLength(1);
  expect(host.querySelector('section[data-home-category="movie"]')).toBeNull();
  expect(host.querySelectorAll('section[data-home-category="anime"] [role="button"]')).toHaveLength(12);
  await choose('电影周榜');
  expect(host.querySelectorAll('section[data-home-category="movie"] [role="button"]')).toHaveLength(12);
});

it('allows switching away from a failed category and retrying it later', async () => {
  let unavailable = true;
  vi.stubGlobal('fetch', async (url: string) => {
    if (unavailable && url.includes('douban_movie_weekly')) return Response.json({ error: 'upstream down' }, { status: 502 });
    return reply(url);
  });
  await render();
  let movie = host.querySelector('section[data-home-category="movie"]');
  expect(movie?.textContent).toContain('加载失败');
  await choose('国产剧周榜');
  expect(host.querySelectorAll('section[data-home-category="chinese"] [role="button"]')).toHaveLength(12);
  await choose('电影周榜');
  movie = host.querySelector('section[data-home-category="movie"]');
  unavailable = false;
  await act(async () => (movie!.querySelector('button') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(movie!.querySelectorAll('[role="button"]')).toHaveLength(12);
});
