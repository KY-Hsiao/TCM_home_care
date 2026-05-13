const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(
  __dirname,
  '..',
  'src',
  'services',
  'visit-automation',
  'visit-automation-service.ts'
);

const source = fs.readFileSync(sourcePath, 'utf8');
const startMarker = '  private async sendArrivalReminderForNextStop(';
const endMarker = '\n  private buildAfterReturnCareRouteKey(';
const start = source.indexOf(startMarker);
const end = start >= 0 ? source.indexOf(endMarker, start) : -1;

if (start < 0 || end < 0) {
  throw new Error('Unable to locate legacy next-stop arrival reminder trigger in visit-automation-service.ts');
}

const replacement = `  private async sendArrivalReminderForNextStop(
    _currentDetail: VisitDetail,
    runtime: TrackingRuntime,
    _triggeredAt: string
  ) {
    appendEvent(runtime, "已移除前一站離開後自動發送下一站抵達前 LINE 提醒。");
    this.notify();
  }
`;

const nextSource = `${source.slice(0, start)}${replacement}${source.slice(end)}`;

if (nextSource !== source) {
  fs.writeFileSync(sourcePath, nextSource, 'utf8');
  console.log('Disabled legacy named next-stop arrival reminder trigger before build.');
} else {
  console.log('Legacy named next-stop arrival reminder trigger already disabled.');
}
