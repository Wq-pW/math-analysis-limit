import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, buildSnapshot, validateSnapshot, sameData } from './leaderboard.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publish = process.argv.includes('--publish');
const token = process.env.GITHUB_TOKEN;

if (publish && (!token || process.env.GITHUB_REPOSITORY !== REPOSITORY)) {
  throw new Error('发布需要仓库范围的 Actions 令牌，且必须运行在目标仓库中。');
}
if (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== 'https://api.github.com') {
  throw new Error('仅支持配置的公开 GitHub API。');
}

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'math-analysis-limit-community',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const error = new Error(`GitHub 请求失败 (${response.status})；保留上次公开快照。`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function openIssues() {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const issues = await request(`issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new Error('Issue 列表响应异常。');
    all.push(...issues);
    if (issues.length < 100) return all;
  }
  throw new Error('公开 Issues 过多，超出一次重建的边界；保留上次快照。');
}

for (let attempt = 0; attempt < 3; attempt += 1) {
  const issues = await openIssues();
  const snapshot = buildSnapshot(issues);
  if (!validateSnapshot(snapshot)) throw new Error('拒绝发布无效生成的快照。');
  let existing = null;
  let sha;
  if (publish) {
    try {
      const file = await request('contents/community.json?ref=main');
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.sha !== 'string' || typeof file.content !== 'string') throw new Error('快照文件响应异常。');
      sha = file.sha;
      existing = validateSnapshot(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
    } catch (error) {
      if (error.status !== 404) throw error;
      // 首次发布无快照文件，正常继续。
    }
  } else {
    try {
      existing = validateSnapshot(JSON.parse(await readFile(resolve(project, 'community.json'), 'utf8')));
    } catch {
      // 本地无文件时从空榜开始。
    }
  }
  if (existing && sameData(existing, snapshot)) {
    console.log(JSON.stringify({ status: 'unchanged', openIssues: issues.length, updatedAt: existing.updatedAt }));
    break;
  }
  const text = JSON.stringify(snapshot, null, 2) + '\n';
  if (!publish) {
    await writeFile(resolve(project, 'community.json'), text);
    console.log(JSON.stringify({ status: 'written', openIssues: issues.length, totalPlayers: snapshot.totalPlayers }));
    break;
  }
  try {
    await request('contents/community.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Update public game leaderboard and comments', content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
    });
    console.log(JSON.stringify({ status: 'published', openIssues: issues.length, totalPlayers: snapshot.totalPlayers }));
    break;
  } catch (error) {
    if (![409, 422].includes(error.status) || attempt === 2) throw error;
    // 并发编辑冲突：重新读取 Issues 与旧文件后再试。
  }
}
