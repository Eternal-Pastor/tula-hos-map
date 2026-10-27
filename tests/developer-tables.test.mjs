import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { context, hash, plain, read } from './helpers.mjs';

const compiled = await transform(read('src/developer/table-data.ts').toString(), { loader: 'ts', format: 'esm', target: 'es2022' });
const { buildTable, formatTableCell, tableCsv, tablePage, TABLE_PAGE_SIZE } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const E = context(['src/engine/core.js', 'src/engine/territories.js', 'public/data.js']);
const data = E.HOSPITAL_DATA;
const territoryIndex = E.HospitalTerritories.index(data);

function sourceFor(settings = {}) {
  settings = { metric: 'per1000', includeMixed: false, populationValues: {}, populationLinks: {}, ...settings };
  const C = E.HospitalCore;
  return {
    data,
    territoryIndex,
    organizationValues: new Map(data.organizations.map(o => [o.id, {
      attached: C.attachedFor(o, settings.includeMixed),
      population: C.populationFor(o, data, settings),
      metric: C.metric(o, settings.metric, data, settings),
      coords: C.locationFor(o, settings)?.coords ?? null,
    }])),
    metricLabel: 'прикреплённых на 1 000 жителей',
    populationValues: settings.populationValues,
    ruleLocations: new Map(),
    ruleAttempts: new Set(),
    ruleFailures: new Map(),
  };
}

test('developer tables preserve all six canonical datasets and missing values', () => {
  const source = sourceFor();
  const before = hash(JSON.stringify(data));
  const expected = { organizations: 38, areas: 560, territories: 10179, addresses: 10831, capacity: 71, population: 30 };
  for (const [kind, count] of Object.entries(expected)) {
    const table = buildTable(source, { kind });
    assert.equal(table.rows.length, count, kind);
    assert.ok(table.description.length > 100, kind);
    assert.ok(table.rows.every(row => row.length === table.headers.length), kind);
  }
  const organizations = buildTable(source, { kind: 'organizations' });
  assert.deepEqual(plain(organizations.rows[0]), [
    'Тульская областная клиническая больница', 4197, 4, 'Тула', 542516,
    source.organizationValues.get('tokb').metric, 'tokb', 54.209492, 37.697152,
    'улица Яблочкова, 1А, Тула',
  ]);
  const missing = organizations.rows.find(row => row[6] === 'arsenyevo');
  assert.equal(missing[1], null, 'unknown attached count is not zero');
  assert.equal(missing[2], null, 'absence of source area rows stays missing');
  assert.equal(missing[5], null, 'missing metric is not zero');
  assert.equal(hash(JSON.stringify(data)), before, 'presentation cannot mutate canonical source data');
});

test('source areas retain duplicate numbers and mixed categories independently of metric settings', () => {
  const source = sourceFor();
  const table = buildTable(source, { kind: 'areas', organizationId: 'tula2' });
  const duplicates = table.rows.filter(row => row[4] === 'Повтор номера внутри организации');
  assert.equal(duplicates.length, 6);
  assert.deepEqual(plain(duplicates.map(row => row[1]).sort()), ['13', '13', '17', '17', '18', '18']);
  assert.equal(new Set(duplicates.map(row => row[5])).size, 6, 'each repeated source row remains distinguishable');
  const all = buildTable(source, { kind: 'areas' });
  const mixed = all.rows.filter(row => row[2] !== 'Взрослые');
  assert.ok(mixed.length > 0);
  assert.deepEqual(plain(buildTable(sourceFor({ includeMixed: true }), { kind: 'areas' }).rows), plain(all.rows));
  assert.deepEqual(plain(buildTable(source, { kind: 'areas', organizationId: 'missing-id' }).rows), []);
});

test('territory table keeps house rules, shared organizations and coordinate verification states', () => {
  const source = sourceFor();
  const org = data.organizations.find(o => (territoryIndex.byOrganization.get(o.id) || []).length > 3);
  const groups = territoryIndex.byOrganization.get(org.id);
  source.ruleLocations.set(groups[0].id, 'house');
  source.ruleAttempts.add(groups[1].id);
  source.ruleFailures.set(groups[1].id, 'адрес не найден');
  source.ruleAttempts.add(groups[2].id);
  const table = buildTable(source, { kind: 'territories', organizationId: org.id });
  assert.deepEqual(plain(table.rows.slice(0, 4).map(row => row[4])), [
    'Найдено: house', 'Не подтверждено: адрес не найден',
    'Не подтверждено: нужна проверка адреса', 'Ещё не проверено',
  ]);
  assert.equal(table.rows[0][2], 'все дома');
  assert.equal(table.rows[0][5], 'DOCX · таблица 42 · строка 3');
  const failed = buildTable(source, { kind: 'territories', organizationId: org.id, search: '  НЕ ПОДТВЕРЖДЕНО  ' });
  assert.equal(failed.rows.length, 2);
  assert.ok(failed.rows.every(row => row[0] === org.shortName));
  const shared = buildTable(source, { kind: 'territories' }).rows.filter(row => row[3]);
  assert.ok(shared.length >= 22, 'shared address texts retain organization attribution');
  const addresses = buildTable(source, { kind: 'addresses', organizationId: org.id });
  assert.equal(addresses.rows[0][4], '_прикрепление новое.docx · таблица 42 · строка 3');
  assert.ok(addresses.rows.some(row => /чет|нечет|\d.*\d/iu.test(row[2])), 'house ranges and parity are not reduced to individual points');
});

test('capacity selection and population overrides preserve their different filtering requirements', () => {
  const source = sourceFor({ populationValues: { 'city-0': 600000 } });
  const capacity = buildTable(source, { kind: 'capacity', organizationId: 'tokb' });
  assert.equal(capacity.rows.length, 1);
  assert.deepEqual(plain(capacity.rows[0]), [
    'Тульская областная клиническая больница', 'Тульская областная клиническая больница',
    350, null, '30_1010_МОЩНОСТЬ.xls · Лист1 · строка 8',
  ]);
  const population = buildTable(source, { kind: 'population', organizationId: 'tokb' });
  assert.equal(population.rows.length, 30, 'population rows ignore organization filter');
  assert.equal(population.rows[0][2], 600000, 'explicit user population is presented');
  assert.equal(population.rows.filter(row => row[2] === 67754).length, 9, 'repeated user values remain separate territories');
  assert.equal(buildTable(source, { kind: 'organizations', organizationId: 'tokb' }).rows[0][4], 600000);
});

test('formatting preserves Yandex coordinate order, precision, nulls and raw display text', () => {
  assert.equal(formatTableCell(54.20949249, 'Широта'), '54,209492');
  assert.equal(formatTableCell(37.69715249, 'Долгота'), '37,697152');
  assert.equal(formatTableCell(12.34567, 'Показатель'), '12,35');
  assert.equal(formatTableCell(null, 'Население'), 'нет данных');
  assert.equal(formatTableCell(0, 'Показатель'), '0');
  assert.equal(formatTableCell('<неизменённый текст>', 'Источник'), '<неизменённый текст>');
});

test('pagination clamps the last page after filtering and CSV exports every filtered source row', () => {
  const table = buildTable(sourceFor(), { kind: 'areas' });
  assert.equal(TABLE_PAGE_SIZE, 75);
  assert.deepEqual([tablePage(table, 0).rows.length, tablePage(table, 7).rows.length], [75, 35]);
  assert.deepEqual([tablePage(table, 100).page, tablePage(table, 100).pageCount], [7, 8]);
  assert.equal(tablePage(table, -1).page, 0);
  const filtered = buildTable(sourceFor(), { kind: 'areas', search: 'Повтор номера' });
  const page = tablePage(filtered, 7);
  assert.deepEqual([page.page, page.pageCount, page.rows.length], [0, 1, 6]);
  const empty = tablePage(buildTable(sourceFor(), { kind: 'areas', search: 'не существующая строка zzz' }), 10);
  assert.deepEqual([empty.page, empty.pageCount, empty.rows.length], [0, 0, 0]);
  const csv = tableCsv(table);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.split('\r\n').length, 561, 'CSV is not limited to the visible 75 rows');
  assert.ok(csv.endsWith('"' + table.rows.at(-1).at(-1) + '"'));
  assert.equal(tableCsv(filtered).split('\r\n').length, 7, 'search applies to the complete exported table');
});

test('CSV preserves raw numbers, semicolons and line breaks, escaping quotes and formula-like text', () => {
  const csv = tableCsv({
    headers: ['Значение', 'Число', 'Пусто'], description: '',
    rows: [
      ['=1+1', -2.5, null], ['+текст', 0, 'a;"b"\r\nc'],
      ['@ссылка', 54.209492, '-текст'],
    ],
  });
  assert.equal(csv, '\ufeff"Значение";"Число";"Пусто"\r\n"\'=1+1";"-2.5";""\r\n"\'+текст";"0";"a;""b""\r\nc"\r\n"\'@ссылка";"54.209492";"\'-текст"');
});
