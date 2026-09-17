// 排行榜/留言的共享逻辑：浏览器生成投稿，GitHub Actions 用它解析公开 Issues 并重建 community.json。
// 无任何凭据存放于此。

export const REPOSITORY = 'Wq-pW/math-analysis-limit';
export const APP = 'math-analysis';
export const FENCE = 'math-analysis';
export const CHAPTER_ID = 'limit';
export const CHAPTER_NAME = '极限的严格定义';
export const QUESTION_COUNT = 12;
export const SNAPSHOT_URL = `https://raw.githubusercontent.com/${REPOSITORY}/main/community.json`;

const MAX_BODY = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => plainObject(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const dateString = v => typeof v === 'string' && v.length <= 30 && Number.isFinite(Date.parse(v)) && /^\d{4}-\d\d-\d\dT/.test(v);
const integer = v => Number.isSafeInteger(v) && v >= 0;
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function textField(value, maximum, allowEmpty = true) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if ((!allowEmpty && normalized.length === 0) || Array.from(normalized).length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) return null;
  return normalized;
}

/** 由逐题标记重新计算分数。marks 为长度等于题数的字符串，每个字符 f(首答)/r(纠错)/h(提示)。 */
export function scoreMarks(marks) {
  if (typeof marks !== 'string' || marks.length !== QUESTION_COUNT || !/^[frh]+$/.test(marks)) return null;
  const firstCorrectCount = (marks.match(/f/g) || []).length;
  const correctedCount = (marks.match(/r/g) || []).length;
  const hintedCount = (marks.match(/h/g) || []).length;
  return {
    score: Math.round((100 * firstCorrectCount + 60 * correctedCount + 30 * hintedCount) / QUESTION_COUNT),
    firstCorrectCount, correctedCount, hintedCount, totalQuestions: QUESTION_COUNT,
  };
}

/** 严格校验并规范化一份成绩包。 */
export function parsePacket(input) {
  let value = input;
  if (typeof input === 'string') { try { value = JSON.parse(input); } catch { return null; } }
  const hasRecordType = plainObject(value) && Object.hasOwn(value, 'recordType');
  if (!exactKeys(value, ['version', 'chapter', 'runId', 'completedAt', 'marks', ...(hasRecordType ? ['recordType'] : [])])) return null;
  if ((hasRecordType && value.recordType !== 'reference') || value.version !== 1 || value.chapter !== CHAPTER_ID) return null;
  if (!scoreMarks(value.marks)) return null;
  if (typeof value.runId !== 'string' || !UUID.test(value.runId)) return null;
  if (!dateString(value.completedAt)) return null;
  return { version: 1, chapter: value.chapter, runId: value.runId.toLowerCase(), completedAt: new Date(value.completedAt).toISOString(), marks: value.marks, ...(hasRecordType ? { recordType: 'reference' } : {}) };
}

function submission(input) {
  if (!plainObject(input) || !['score', 'comment'].includes(input.kind)) return null;
  const fields = ['app', 'version', 'kind', 'chapter', 'nickname', 'comment', 'rating', ...(input.kind === 'score' ? ['packet'] : [])];
  if (!exactKeys(input, fields) || input.app !== APP || input.version !== 1 || input.chapter !== CHAPTER_ID) return null;
  const nickname = textField(input.nickname, 24);
  const comment = textField(input.comment, 500);
  if (nickname === null || /[\r\n\t]/.test(nickname) || comment === null) return null;
  if (!(input.rating === null || (Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5))) return null;
  const common = { app: APP, version: 1, kind: input.kind, chapter: input.chapter, nickname, comment, rating: input.rating };
  if (input.kind === 'comment') return (comment || input.rating !== null) ? common : null;
  const packet = parsePacket(input.packet);
  return packet?.chapter === input.chapter ? { ...common, packet } : null;
}

function bodyFor(record) {
  const stats = record.kind === 'score' ? scoreMarks(record.packet.marks) : null;
  const introduction = stats
    ? `我完成了《${CHAPTER_NAME}》，本次自报成绩为 **${stats.score} / 100**。`
    : `我想对《${CHAPTER_NAME}》提交评论。`;
  return [introduction, '', '本帖公开发布后，GitHub账号、显示名、成绩及填写的评论会进入游戏社区。关闭本帖可从下次更新的榜单中撤回。成绩用于交流，不作为正式考核凭证。', '', '下面是游戏生成的提交记录；请保留记录格式。', '', `\`\`\`${FENCE}`, JSON.stringify(record, null, 2), '```', ''].join('\n');
}

function draft(record) {
  const body = bodyFor(record);
  const url = new URL(`https://github.com/${REPOSITORY}/issues/new`);
  url.searchParams.set('template', record.kind === 'score' ? 'score.md' : 'comment.md');
  url.searchParams.set('title', `${record.kind === 'score' ? '成绩' : '评论'} · ${CHAPTER_NAME}`);
  url.searchParams.set('body', body);
  const copyRequired = url.href.length > 7000;
  if (copyRequired) url.searchParams.delete('body');
  return { url: url.href, body, copyRequired };
}

export function buildScoreDraftUrl(packetInput, { nickname = '', comment = '', rating = null } = {}) {
  const packet = parsePacket(packetInput);
  const record = packet && submission({ app: APP, version: 1, kind: 'score', chapter: packet.chapter, nickname, comment, rating, packet });
  if (!record) throw new TypeError('成绩记录或填写内容不完整：显示名最多24字，评论最多500字，星级为1至5。');
  return draft(record);
}

export function buildCommentDraftUrl({ nickname = '', comment = '', rating = null }) {
  const record = submission({ app: APP, version: 1, kind: 'comment', chapter: CHAPTER_ID, nickname, comment, rating });
  if (!record) throw new TypeError('请填写评论或星级；显示名最多24字，评论最多500字。');
  return draft(record);
}

/** 只解析恰好一个明确标记的代码块；Issue 正文始终作为不可信数据处理。 */
export function parseIssueSubmission(body) {
  if (typeof body !== 'string' || body.length > MAX_BODY) return null;
  const blocks = [...body.matchAll(new RegExp('^```' + FENCE + '\\s*\\r?\\n([\\s\\S]*?)\\r?\\n```\\s*$', 'gm'))];
  if (blocks.length !== 1) return null;
  try { return submission(JSON.parse(blocks[0][1])); } catch { return null; }
}

export function emptySnapshot(updatedAt = new Date().toISOString()) {
  return { version: 1, updatedAt: new Date(updatedAt).toISOString(), repository: REPOSITORY, source: 'github-issues', selfReported: true, totalPlayers: 0, entries: [], comments: [] };
}

// 分数高者在前；同分保留完整新记录优先，其余仅用于确定性排序，同分仍并列名次。
const compareScores = (a, b) => b.score - a.score || Number(a.recordType === 'reference') - Number(b.recordType === 'reference') || compareText(a.submittedAt, b.submittedAt) || a.issueNumber - b.issueNumber;

/** 将当前公开 Issues 归约为一份快照。 */
export function buildSnapshot(issues, updatedAt = new Date().toISOString()) {
  if (!Array.isArray(issues) || !dateString(updatedAt)) throw new TypeError('Invalid snapshot inputs.');
  const snapshot = emptySnapshot(updatedAt);
  const scoreMap = new Map();
  const commentMap = new Map();
  for (const issue of issues) {
    if (!plainObject(issue) || issue.state !== 'open' || issue.pull_request || issue.user?.type !== 'User') continue;
    if (!Number.isSafeInteger(issue.user.id) || issue.user.id <= 0 || typeof issue.user.login !== 'string' || !LOGIN.test(issue.user.login)) continue;
    if (!integer(issue.number) || issue.number === 0 || !dateString(issue.created_at)) continue;
    if (Array.isArray(issue.labels) && issue.labels.some(l => (typeof l === 'string' ? l : l?.name) === 'community-hidden')) continue;
    const record = parseIssueSubmission(issue.body);
    if (!record) continue;
    const author = { login: issue.user.login, nickname: record.nickname || issue.user.login.slice(0, 24), submittedAt: new Date(issue.created_at).toISOString(), issueNumber: issue.number, issueUrl: `https://github.com/${REPOSITORY}/issues/${issue.number}` };
    if (record.kind === 'score') {
      const entry = { ...author, ...scoreMarks(record.packet.marks), completedAt: record.packet.completedAt, ...(record.packet.recordType === 'reference' ? { recordType: 'reference' } : {}) };
      const previous = scoreMap.get(issue.user.id);
      if (!previous || compareScores(entry, previous) < 0) scoreMap.set(issue.user.id, entry);
    }
    if (record.comment || record.rating !== null) {
      const item = { ...author, body: record.comment, rating: record.rating };
      const previous = commentMap.get(issue.user.id);
      if (!previous || item.submittedAt > previous.submittedAt || (item.submittedAt === previous.submittedAt && item.issueNumber > previous.issueNumber)) commentMap.set(issue.user.id, item);
    }
  }
  const entries = [...scoreMap.values()].sort(compareScores);
  let rank = 0;
  snapshot.totalPlayers = entries.length;
  snapshot.entries = entries.slice(0, 100).map((entry, index) => {
    if (index === 0 || entry.score !== entries[index - 1].score) rank = index + 1;
    return { rank, ...entry };
  });
  snapshot.comments = [...commentMap.values()].sort((a, b) => compareText(b.submittedAt, a.submittedAt) || b.issueNumber - a.issueNumber).slice(0, 30);
  return snapshot;
}

/** 返回可安全渲染的规范快照，或 null。所有文本一律按文本渲染，绝不当作 HTML。 */
export function validateSnapshot(value) {
  if (!exactKeys(value, ['version', 'updatedAt', 'repository', 'source', 'selfReported', 'totalPlayers', 'entries', 'comments'])) return null;
  if (value.version !== 1 || !dateString(value.updatedAt) || value.repository !== REPOSITORY || value.source !== 'github-issues' || value.selfReported !== true || !integer(value.totalPlayers) || !Array.isArray(value.entries) || !Array.isArray(value.comments)) return null;
  if (value.entries.length !== Math.min(100, value.totalPlayers) || value.comments.length > 30) return null;
  const entries = [], comments = [], players = new Set(), commenters = new Set();
  const author = item => {
    if (typeof item.login !== 'string' || !LOGIN.test(item.login) || textField(item.nickname, 24, false) !== item.nickname || /[\r\n\t]/.test(item.nickname) || !integer(item.issueNumber) || item.issueNumber === 0 || item.issueUrl !== `https://github.com/${REPOSITORY}/issues/${item.issueNumber}` || !dateString(item.submittedAt)) return null;
    return { login: item.login, nickname: item.nickname, submittedAt: new Date(item.submittedAt).toISOString(), issueNumber: item.issueNumber, issueUrl: item.issueUrl };
  };
  for (const item of value.entries) {
    const hasRecordType = plainObject(item) && Object.hasOwn(item, 'recordType');
    const keys = ['rank', 'login', 'nickname', 'submittedAt', 'issueNumber', 'issueUrl', 'score', 'firstCorrectCount', 'correctedCount', 'hintedCount', 'totalQuestions', 'completedAt', ...(hasRecordType ? ['recordType'] : [])];
    if (!exactKeys(item, keys) || (hasRecordType && item.recordType !== 'reference')) return null;
    const identity = author(item);
    if (!identity || players.has(item.login.toLowerCase()) || !integer(item.rank) || item.rank === 0 || !dateString(item.completedAt)) return null;
    if (!integer(item.firstCorrectCount) || !integer(item.correctedCount) || !integer(item.hintedCount) || item.totalQuestions !== QUESTION_COUNT || item.firstCorrectCount + item.correctedCount + item.hintedCount !== QUESTION_COUNT) return null;
    const expected = Math.round((100 * item.firstCorrectCount + 60 * item.correctedCount + 30 * item.hintedCount) / item.totalQuestions);
    const previous = entries.at(-1);
    if (item.score !== expected || (previous && item.score > previous.score) || item.rank !== (previous?.score === item.score ? previous.rank : entries.length + 1)) return null;
    players.add(item.login.toLowerCase());
    entries.push({ rank: item.rank, ...identity, score: item.score, firstCorrectCount: item.firstCorrectCount, correctedCount: item.correctedCount, hintedCount: item.hintedCount, totalQuestions: item.totalQuestions, completedAt: new Date(item.completedAt).toISOString(), ...(hasRecordType ? { recordType: 'reference' } : {}) });
  }
  for (const item of value.comments) {
    if (!exactKeys(item, ['login', 'nickname', 'submittedAt', 'issueNumber', 'issueUrl', 'body', 'rating'])) return null;
    const identity = author(item);
    if (!identity || commenters.has(item.login.toLowerCase()) || textField(item.body, 500) !== item.body) return null;
    if (!(item.rating === null || (Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5)) || (!item.body && item.rating === null) || (comments.at(-1)?.submittedAt < item.submittedAt)) return null;
    commenters.add(item.login.toLowerCase());
    comments.push({ ...identity, body: item.body, rating: item.rating });
  }
  return { ...value, updatedAt: new Date(value.updatedAt).toISOString(), entries, comments };
}

/** 比较规范化的公开记录，仅忽略重建时间戳。 */
export function sameData(left, right) {
  const a = validateSnapshot(left), b = validateSnapshot(right);
  if (!a || !b) return false;
  delete a.updatedAt; delete b.updatedAt;
  return JSON.stringify(a) === JSON.stringify(b);
}
