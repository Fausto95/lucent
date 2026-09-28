// The Lab screens' results in the device log, where scripts find them:
// console output in Lucent code goes to os_log on iOS and logcat (tag
// "Lucent") on Android, in Release builds too.

export function logLine(line: string): void {
  console.log(line);
}
