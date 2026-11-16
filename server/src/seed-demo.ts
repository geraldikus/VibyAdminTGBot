/**
 * Fills a separate demo database with a made-up school, for local demos and screenshots.
 *
 *   npm run seed:demo            # creates data/demo.db (refuses if it already has data)
 *   npm run seed:demo -- --force # wipes data/demo.db and seeds it again
 *
 * Always writes to data/demo.db (or DEMO_DB_PATH), never to the real database.
 * All names are fictional.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = path.resolve(rootDir, process.env.DEMO_DB_PATH || 'data/demo.db');
// Must be set before the app modules (config, db) are imported.
process.env.DB_PATH = dbPath;
process.env.BOT_TOKEN = '';

if (process.argv.includes('--force')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
}

const { db, tx } = await import('./db/index.js');
const { setSetting } = await import('./db/rows.js');
const { approveTeacher, upsertPendingTeacher } = await import('./services/teachers.js');
const { createStudent } = await import('./services/students.js');
const { applyBalanceChangeSync } = await import('./services/balance.js');
const { generateBusinessReport } = await import('./services/reports.js');
const { formatDateTime, formatYmd, previousMonth } = await import('./time.js');
type Teacher = import('@school/shared').Teacher;
type Student = import('@school/shared').Student;

const existing = (db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n;
if (existing) {
  console.error(`${dbPath} already has data. Run with --force to recreate it.`);
  process.exit(1);
}

const TEACHERS = [
  { telegramId: '1001', name: 'Emma Wilson', username: 'emma_teaches' },
  { telegramId: '1002', name: 'James Carter', username: 'jcarter' },
  { telegramId: '1003', name: 'Sofia Lind', username: 'sofia_lind' },
];

type Seed = { name: string; teacher: number; type?: 'subscription' | 'business'; status: 'green' | 'yellow' | 'red' | 'blue'; balance: number; contact: string };
const STUDENTS: Seed[] = [
  { name: 'Olivia Brown', teacher: 0, status: 'green', balance: 7, contact: '@olivia_b' },
  { name: 'Liam Novak', teacher: 0, status: 'green', balance: 2, contact: '+358 40 123 4567' },
  { name: 'Ava Martinez', teacher: 0, status: 'yellow', balance: 1, contact: '@ava_m' },
  { name: 'Noah Kim', teacher: 0, status: 'red', balance: 0, contact: '@noahkim' },
  { name: 'Mia Laine', teacher: 1, status: 'green', balance: 11, contact: '@mia_laine' },
  { name: 'Lucas Berg', teacher: 1, status: 'green', balance: 4, contact: '+358 50 765 4321' },
  { name: 'Isla Moreau', teacher: 1, status: 'yellow', balance: 0, contact: '@isla' },
  { name: 'Northwind Logistics', teacher: 1, type: 'business', status: 'blue', balance: 0, contact: 'hr@northwind.example' },
  { name: 'Leo Virtanen', teacher: 2, status: 'green', balance: 9, contact: '@leo_v' },
  { name: 'Ella Novotná', teacher: 2, status: 'green', balance: 3, contact: '@ella_n' },
  { name: 'Aurora Studio', teacher: 2, type: 'business', status: 'blue', balance: 0, contact: 'team@aurora.example' },
  { name: 'Hugo Salo', teacher: 2, status: 'red', balance: -1, contact: '@hugo_s' },
];

const COMMENTS = ['', '', '', 'Past simple, irregular verbs', 'Speaking: job interview', 'Homework checked', 'Phrasal verbs', ''];
const DURATIONS = [60, 60, 45, 90, 60, 30];

const now = new Date();
const daysAgo = (d: number, hour = 10, minute = 0) => {
  const t = new Date(now.getTime() - d * 86_400_000);
  t.setHours(hour, minute, 0, 0);
  return t;
};

// ---- teachers & students (through the real services, so balance logs are consistent)
const teacherRows: Teacher[] = [];
for (const t of TEACHERS) {
  const { teacher } = await upsertPendingTeacher(t);
  teacherRows.push(await approveTeacher(teacher.teacher_id, 'Admin'));
}
// One pending sign-up waiting for approval.
await upsertPendingTeacher({ telegramId: '1004', name: 'Daniel Okafor', username: 'dan_okafor' });

const students: Array<{ seed: Seed; row: Student }> = [];
for (const s of STUDENTS) {
  // Start from the balance the student would have had before the seeded lessons.
  students.push({
    seed: s,
    row: await createStudent({
      name: s.name,
      contact: s.contact,
      teacher_id: teacherRows[s.teacher].teacher_id,
      type: s.type ?? 'subscription',
      status: s.status,
      balance: 0,
      notes: s.type === 'business' ? 'Invoiced monthly' : '',
    }, 'Admin'),
  });
}

// ---- lessons over the last ~7 weeks
const insertLesson = db.prepare(`
  INSERT INTO lessons (lesson_id, created_at, lesson_date, student_id, student_name, teacher_id, teacher_name,
    duration_min, student_type, status_at_lesson, state, photo_link, photo_file_id, photo_message_id,
    balance_after, comment, confirmed_at, reminder_sent, admin_alerted, cancelled_at, cancelled_by)
  VALUES (@lesson_id, @created_at, @lesson_date, @student_id, @student_name, @teacher_id, @teacher_name,
    @duration_min, @student_type, @status_at_lesson, @state, @photo_link, '', @photo_message_id,
    @balance_after, @comment, @confirmed_at, '', '', @cancelled_at, @cancelled_by)`);

let message = 1000;
let n = 0;
tx(() => {
  for (const { seed, row } of students) {
    const teacher = teacherRows[seed.teacher];
    const isSub = row.type === 'subscription';
    // Lessons per student: two a week for the busiest, fewer for others.
    const count = 6 + (n % 5) * 2;
    let paidBefore = 0;
    for (let i = count; i >= 1; i--) {
      n++;
      const day = Math.round((i * 49) / count) - 1;
      const at = daysAgo(Math.max(day, 0), 9 + (n % 9), (n * 7) % 60);
      const cancelled = n % 17 === 0;
      if (isSub && paidBefore === 0) {
        // Top up a package of 8 whenever it runs out, like a real school.
        applyBalanceChangeSync({ studentId: row.student_id, change: 8, reason: 'top_up', by: 'Admin' });
        paidBefore = 8;
      }
      let balanceAfter = '';
      if (!cancelled && isSub) {
        balanceAfter = String(applyBalanceChangeSync({
          studentId: row.student_id, change: -1, reason: 'lesson', by: teacher.name,
        }).balanceAfter);
        paidBefore--;
      }
      message++;
      insertLesson.run({
        lesson_id: randomUUID(),
        created_at: formatDateTime(at),
        lesson_date: formatYmd(at),
        student_id: row.student_id,
        student_name: row.name,
        teacher_id: teacher.teacher_id,
        teacher_name: teacher.name,
        duration_min: DURATIONS[n % DURATIONS.length],
        student_type: row.type,
        status_at_lesson: row.status,
        state: cancelled ? 'cancelled' : 'done',
        photo_link: `https://t.me/c/1234567890/${message}`,
        photo_message_id: String(message),
        balance_after: balanceAfter,
        comment: COMMENTS[n % COMMENTS.length],
        confirmed_at: formatDateTime(new Date(at.getTime() + 3 * 60_000)),
        cancelled_at: cancelled ? formatDateTime(new Date(at.getTime() + 60 * 60_000)) : '',
        cancelled_by: cancelled ? 'Admin' : '',
      });
    }
    // Bring the balance to the value from the seed list (top-up or correction), keeping the log consistent.
    if (isSub) {
      const current = (db.prepare('SELECT balance FROM students WHERE student_id = ?').get(row.student_id) as { balance: number }).balance;
      if (current !== seed.balance) {
        applyBalanceChangeSync({
          studentId: row.student_id,
          change: seed.balance - current,
          reason: seed.balance > current ? 'top_up' : 'manual',
          by: 'Admin',
        });
      }
    }
    db.prepare('UPDATE students SET status = ? WHERE student_id = ?').run(seed.status, row.student_id);
  }

  // Two lessons marked today that are still waiting for a photo.
  for (const [i, idx] of [0, 5].entries()) {
    const { row, seed } = students[idx];
    const teacher = teacherRows[seed.teacher];
    const at = new Date(now.getTime() - (40 + i * 25) * 60_000);
    insertLesson.run({
      lesson_id: randomUUID(),
      created_at: formatDateTime(at),
      lesson_date: formatYmd(at),
      student_id: row.student_id,
      student_name: row.name,
      teacher_id: teacher.teacher_id,
      teacher_name: teacher.name,
      duration_min: 60,
      student_type: row.type,
      status_at_lesson: seed.status,
      state: 'pending_photo',
      photo_link: '',
      photo_message_id: '',
      balance_after: '',
      comment: '',
      confirmed_at: '',
      cancelled_at: '',
      cancelled_by: '',
    });
  }
});

setSetting('photo_channel_id', '-1001234567890');
await generateBusinessReport(previousMonth(), 'auto');

const counts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM teachers) AS teachers,
  (SELECT COUNT(*) FROM students) AS students,
  (SELECT COUNT(*) FROM lessons) AS lessons,
  (SELECT COUNT(*) FROM balance_log) AS balance_log`).get();
console.log(`Demo database ready: ${dbPath}`);
console.table(counts);
console.log('Run `npm run demo` and open http://localhost:5173 (admin). Teacher view: localStorage.devUser = "teacher:1001:<teacher_id>"');
process.exit(0);
