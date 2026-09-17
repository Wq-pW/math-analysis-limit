import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP, CHAPTER_ID, QUESTION_COUNT, REPOSITORY,
  scoreMarks, buildScoreDraftUrl, buildCommentDraftUrl, parseIssueSubmission,
  buildSnapshot, validateSnapshot, sameData,
} from './leaderboard.mjs';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

function packet(marks) {
  return { version: 1, chapter: CHAPTER_ID, runId: RUN_ID, completedAt: '2026-09-17T08:00:00.000Z', marks };
}

function scoreIssue({ id, login, body, created = '2026-09-17T08:00:00.000Z', number = 1, state = 'open', labels = [] }) {
  return { state, pull_request: null, user: { id, login, type: 'User' }, number, created_at: created, labels, body };
}

test('scoreMarks 按 100/60/30 重新计分', () => {
  assert.deepEqual(scoreMarks('ffffffffffff'), { score: 100, firstCorrectCount: 12, correctedCount: 0, hintedCount: 0, totalQuestions: 12 });
  assert.deepEqual(scoreMarks('rrrrrrrrrrrr'), { score: 60, firstCorrectCount: 0, correctedCount: 12, hintedCount: 0, totalQuestions: 12 });
  assert.deepEqual(scoreMarks('hhhhhhhhhhhh'), { score: 30, firstCorrectCount: 0, correctedCount: 0, hintedCount: 12, totalQuestions: 12 });
  // 4f + 4r + 4h = (400 + 240 + 120)/12 = 63.33 -> 63
  assert.equal(scoreMarks('ffffrrrrhhhh').score, 63);
  assert.equal(scoreMarks('ffffrrrhhhhh').score, 61); // (400+180+150)/12 = 60.83 -> 61
});

test('成绩投稿可在浏览器草稿与解析器之间往返', () => {
  const draft = buildScoreDraftUrl(packet('ffffrrrrhhhh'), { nickname: '无名氏', comment: '量词顺序讲得很清楚', rating: 5 });
  assert.ok(draft.url.includes('template=score.md'));
  assert.ok(draft.body.includes('```' + APP));
  const record = parseIssueSubmission(draft.body);
  assert.ok(record);
  assert.equal(record.kind, 'score');
  assert.equal(record.nickname, '无名氏');
  assert.equal(record.rating, 5);
  assert.equal(record.packet.marks, 'ffffrrrrhhhh');
  assert.equal(scoreMarks(record.packet.marks).score, 63);
});

test('评论投稿往返，且空评论+空星级被拒绝', () => {
  const draft = buildCommentDraftUrl({ nickname: '审查官', comment: '结局很有画面感', rating: 4 });
  const record = parseIssueSubmission(draft.body);
  assert.equal(record.kind, 'comment');
  assert.equal(record.comment, '结局很有画面感');
  assert.equal(record.rating, 4);
  assert.throws(() => buildCommentDraftUrl({ nickname: 'x', comment: '', rating: null }));
});

test('buildSnapshot：排序、同分并列、最高分保留、关闭撤回、隐藏标签', () => {
  const a = buildScoreDraftUrl(packet('ffffffffffff'), { nickname: '甲', rating: 5 }).body; // 100
  const b = buildScoreDraftUrl(packet('rrrrrrrrrrrr'), { nickname: '乙', rating: 4 }).body; // 60
  const c = buildScoreDraftUrl(packet('rrrrrrrrrrrr'), { nickname: '丙' }).body;          // 60，与乙同分
  const issues = [
    scoreIssue({ id: 1, login: 'alice', number: 1, body: a, created: '2026-09-17T08:00:00.000Z' }),
    scoreIssue({ id: 2, login: 'bob', number: 2, body: b, created: '2026-09-17T08:01:00.000Z' }),
    scoreIssue({ id: 3, login: 'carol', number: 3, body: c, created: '2026-09-17T08:02:00.000Z' }),
    scoreIssue({ id: 1, login: 'alice', number: 4, body: b, created: '2026-09-17T08:03:00.000Z' }), // alice 另一条低分，应保留最高分 100
  ];
  const snap = buildSnapshot(issues);
  assert.equal(snap.totalPlayers, 3);
  assert.deepEqual(snap.entries.map(e => [e.login, e.score, e.rank]), [['alice', 100, 1], ['bob', 60, 2], ['carol', 60, 2]]);
  assert.equal(snap.comments.length, 2); // 甲、乙各一条，丙无评论无星级
  assert.ok(validateSnapshot(snap));
  assert.ok(sameData(snap, snap));

  // 关闭 alice 的帖子 -> 其成绩与评论一并撤回
  const closed = issues.map(i => (i.user.login === 'alice' ? { ...i, state: 'closed' } : i));
  const snap2 = buildSnapshot(closed);
  assert.equal(snap2.totalPlayers, 2);
  assert.deepEqual(snap2.entries.map(e => e.login), ['bob', 'carol']);

  // community-hidden 标签 -> 跳过
  const hidden = issues.map(i => ({ ...i, labels: [{ name: 'community-hidden' }] }));
  const snap3 = buildSnapshot(hidden);
  assert.equal(snap3.totalPlayers, 0);
});

test('无效正文被忽略', () => {
  assert.equal(parseIssueSubmission('普通文字，没有代码块'), null);
  assert.equal(parseIssueSubmission('```' + APP + '\n{bad json}\n```'), null);
  assert.equal(parseIssueSubmission('```' + APP + '\n{"app":"other"}\n```'), null);
});
