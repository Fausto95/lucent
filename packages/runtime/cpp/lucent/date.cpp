#include "date.h"

#include <cmath>
#include <cstdio>
#include <ctime>
#include <string>

#include "jserror.h"
#include "number.h"

namespace lucent {

namespace {

constexpr double kMsPerSecond = 1000;
constexpr double kMsPerMinute = 60000;
constexpr double kMsPerHour = 3600000;
constexpr double kMsPerDay = 86400000;

const char* const kDays[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
const char* const kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

double posMod(double a, double b) {
  double r = std::fmod(a, b);
  return r < 0 ? r + b : r;
}

// --- ECMAScript time value algorithms (ECMA-262 §21.4.1) -------------------------------------

double day(double t) { return std::floor(t / kMsPerDay); }
double timeWithinDay(double t) { return posMod(t, kMsPerDay); }
double daysInYear(double y) {
  if (std::fmod(y, 4) != 0) return 365;
  if (std::fmod(y, 100) != 0) return 366;
  if (std::fmod(y, 400) != 0) return 365;
  return 366;
}
double dayFromYear(double y) {
  return 365 * (y - 1970) + std::floor((y - 1969) / 4) - std::floor((y - 1901) / 100) + std::floor((y - 1601) / 400);
}
double timeFromYear(double y) { return kMsPerDay * dayFromYear(y); }
double yearFromTime(double t) {
  double y = std::floor(t / (kMsPerDay * 365.2425)) + 1970;
  while (timeFromYear(y) > t) y--;
  while (timeFromYear(y + 1) <= t) y++;
  return y;
}
bool inLeapYear(double t) { return daysInYear(yearFromTime(t)) == 366; }
double dayWithinYear(double t) { return day(t) - dayFromYear(yearFromTime(t)); }

// First day of each month in a common year, and in a leap year.
const int kMonthStart[2][13] = {{0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365},
                                {0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366}};

double monthFromTime(double t) {
  double d = dayWithinYear(t);
  const int* starts = kMonthStart[inLeapYear(t) ? 1 : 0];
  int m = 0;
  while (m < 11 && d >= starts[m + 1]) m++;
  return m;
}
double dateFromTime(double t) {
  return dayWithinYear(t) - kMonthStart[inLeapYear(t) ? 1 : 0][static_cast<int>(monthFromTime(t))] + 1;
}
double weekDay(double t) { return posMod(day(t) + 4, 7); }
double hourFromTime(double t) { return posMod(std::floor(t / kMsPerHour), 24); }
double minFromTime(double t) { return posMod(std::floor(t / kMsPerMinute), 60); }
double secFromTime(double t) { return posMod(std::floor(t / kMsPerSecond), 60); }
double msFromTime(double t) { return posMod(t, kMsPerSecond); }

double makeTime(double h, double m, double s, double ms) {
  if (!std::isfinite(h) || !std::isfinite(m) || !std::isfinite(s) || !std::isfinite(ms)) return kNaN;
  return std::trunc(h) * kMsPerHour + std::trunc(m) * kMsPerMinute + std::trunc(s) * kMsPerSecond + std::trunc(ms);
}
double makeDay(double year, double month, double date) {
  if (!std::isfinite(year) || !std::isfinite(month) || !std::isfinite(date)) return kNaN;
  double y = std::trunc(year), m = std::trunc(month), dt = std::trunc(date);
  double ym = y + std::floor(m / 12);
  if (std::fabs(ym) > 400000) return kNaN;
  int mn = static_cast<int>(posMod(m, 12));
  double first = dayFromYear(ym) + kMonthStart[daysInYear(ym) == 366 ? 1 : 0][mn];
  return first + dt - 1;
}
double timeValue(double dayValue, double time) {
  if (!std::isfinite(dayValue) || !std::isfinite(time)) return kNaN;
  double tv = dayValue * kMsPerDay + time;
  return std::isfinite(tv) ? tv : kNaN;
}
double timeClip(double t) {
  if (!std::isfinite(t) || std::fabs(t) > 8.64e15) return kNaN;
  return std::trunc(t) + 0.0;  // + 0.0 turns -0 into +0
}

// --- local time ----------------------------------------------------------------------------------

/// The zone's offset from UTC at the UTC instant `t`, in milliseconds.
double offsetAt(double t) {
  if (!std::isfinite(t)) return 0;
  std::time_t secs = static_cast<std::time_t>(std::floor(t / kMsPerSecond));
  std::tm tm{};
  if (!::localtime_r(&secs, &tm)) return 0;
  return static_cast<double>(tm.tm_gmtoff) * kMsPerSecond;
}
double localTime(double t) { return t + offsetAt(t); }

/// The UTC instant of local time `t`. Offsets a day before and after bracket
/// any transition: a time valid with both (no transition, or the fall-back
/// overlap) resolves to the earlier instant; a time valid with neither (the
/// spring-forward gap) uses the offset before the transition.
double utcFromLocal(double t) {
  if (!std::isfinite(t)) return kNaN;
  double before = offsetAt(t - kMsPerDay), after = offsetAt(t + kMsPerDay);
  double ub = t - before, ua = t - after;
  bool okBefore = offsetAt(ub) == before, okAfter = offsetAt(ua) == after;
  if (okBefore && okAfter) return std::min(ub, ua);
  if (okAfter) return ua;
  return ub;
}

std::string pad(double v, int width) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%0*lld", width, static_cast<long long>(v));
  return buf;
}
std::string yearString(double y) {
  if (y >= 0) return pad(y, 4);
  return "-" + pad(-y, 6);
}
std::string offsetString(double offsetMs) {
  double mins = offsetMs / kMsPerMinute;
  char sign = mins < 0 ? '-' : '+';
  mins = std::fabs(mins);
  return std::string("GMT") + sign + pad(std::floor(mins / 60), 2) + pad(std::fmod(mins, 60), 2);
}
std::string datePart(double lt) {
  return std::string(kDays[static_cast<int>(weekDay(lt))]) + " " + kMonths[static_cast<int>(monthFromTime(lt))] + " " + pad(dateFromTime(lt), 2) + " " +
         yearString(yearFromTime(lt));
}
std::string timePart(double lt) { return pad(hourFromTime(lt), 2) + ":" + pad(minFromTime(lt), 2) + ":" + pad(secFromTime(lt), 2); }

// --- parsing -------------------------------------------------------------------------------------

struct Cursor {
  std::string s;
  size_t i = 0;
  bool done() const { return i >= s.size(); }
  char peek() const { return done() ? '\0' : s[i]; }
  bool eat(char c) {
    if (peek() != c) return false;
    i++;
    return true;
  }
  /// Exactly `n` digits.
  bool digits(int n, double& out) {
    if (i + n > s.size()) return false;
    double v = 0;
    for (int k = 0; k < n; k++) {
      char c = s[i + k];
      if (c < '0' || c > '9') return false;
      v = v * 10 + (c - '0');
    }
    i += n;
    out = v;
    return true;
  }
  /// One or more digits.
  bool number(double& out) {
    size_t start = i;
    double v = 0;
    while (!done() && s[i] >= '0' && s[i] <= '9') v = v * 10 + (s[i++] - '0');
    out = v;
    return i > start;
  }
  void spaces() {
    while (!done() && (s[i] == ' ' || s[i] == ',')) i++;
  }
  std::string word() {
    size_t start = i;
    while (!done() && ((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z'))) i++;
    return s.substr(start, i - start);
  }
};

double parseIso(const std::string& text) {
  Cursor c{text};
  double year, month = 1, dayOfMonth = 1, h = 0, m = 0, s = 0, ms = 0;
  if (c.peek() == '+' || c.peek() == '-') {
    bool neg = c.peek() == '-';
    c.i++;
    if (!c.digits(6, year)) return kNaN;
    if (neg && year == 0) return kNaN;
    if (neg) year = -year;
  } else if (!c.digits(4, year)) {
    return kNaN;
  }
  if (c.eat('-')) {
    if (!c.digits(2, month) || month < 1 || month > 12) return kNaN;
    if (c.eat('-') && (!c.digits(2, dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) return kNaN;
  }
  bool hasTime = false, hasOffset = false;
  double offset = 0;
  if (c.eat('T')) {
    hasTime = true;
    if (!c.digits(2, h) || !c.eat(':') || !c.digits(2, m)) return kNaN;
    if (c.eat(':')) {
      if (!c.digits(2, s)) return kNaN;
      if (c.eat('.')) {
        size_t start = c.i;
        double frac;
        if (!c.number(frac)) return kNaN;
        std::string digits = text.substr(start, c.i - start);
        digits.resize(3, '0');
        ms = std::stod(digits);
      }
    }
    if (h > 24 || m > 59 || s > 59 || (h == 24 && (m > 0 || s > 0 || ms > 0))) return kNaN;
    if (c.eat('Z')) {
      hasOffset = true;
    } else if (c.peek() == '+' || c.peek() == '-') {
      double sign = c.peek() == '-' ? -1 : 1;
      c.i++;
      double oh, om;
      if (!c.digits(2, oh) || !c.eat(':') || !c.digits(2, om) || oh > 23 || om > 59) return kNaN;
      hasOffset = true;
      offset = sign * (oh * kMsPerHour + om * kMsPerMinute);
    }
  }
  if (!c.done()) return kNaN;
  double t = timeValue(makeDay(year, month - 1, dayOfMonth), makeTime(h, m, s, ms));
  // Date-only forms are UTC; date-times without an offset are local.
  if (hasTime && !hasOffset) return timeClip(utcFromLocal(t));
  return timeClip(t - offset);
}

int monthIndex(const std::string& w) {
  for (int i = 0; i < 12; i++) {
    if (w.size() >= 3 && (w[0] | 32) == (kMonths[i][0] | 32) && (w[1] | 32) == kMonths[i][1] && (w[2] | 32) == kMonths[i][2]) return i;
  }
  return -1;
}

/// "Mon Jul 22 2019 15:51:50 GMT-0700 (…)" and "Mon, 22 Jul 2019 22:51:50 GMT".
double parseLegacy(const std::string& text) {
  Cursor c{text};
  c.spaces();
  std::string w = c.word();
  if (!w.empty() && monthIndex(w) < 0) {
    c.spaces();  // weekday
    w = c.word();
  }
  double dayOfMonth, year;
  int month;
  if (!w.empty()) {  // "Jul 22 2019"
    month = monthIndex(w);
    c.spaces();
    if (month < 0 || !c.number(dayOfMonth)) return kNaN;
  } else {  // "22 Jul 2019"
    if (!c.number(dayOfMonth)) return kNaN;
    c.spaces();
    month = monthIndex(c.word());
    if (month < 0) return kNaN;
  }
  c.spaces();
  bool negYear = c.eat('-');
  if (!c.number(year)) return kNaN;
  if (negYear) year = -year;
  double h = 0, m = 0, s = 0;
  c.spaces();
  if (c.number(h)) {
    if (!c.eat(':') || !c.number(m)) return kNaN;
    if (c.eat(':') && !c.number(s)) return kNaN;
  }
  c.spaces();
  bool hasZone = false;
  double offset = 0;
  std::string zone = c.word();
  if (zone == "GMT" || zone == "UTC" || zone == "Z") {
    hasZone = true;
    if (c.peek() == '+' || c.peek() == '-') {
      double sign = c.peek() == '-' ? -1 : 1;
      c.i++;
      double hhmm;
      size_t start = c.i;
      if (!c.number(hhmm) || c.i - start != 4) return kNaN;
      offset = sign * (std::floor(hhmm / 100) * kMsPerHour + std::fmod(hhmm, 100) * kMsPerMinute);
    }
  } else if (!zone.empty()) {
    return kNaN;
  }
  c.spaces();
  if (c.eat('(')) {
    while (!c.done() && c.peek() != ')') c.i++;
    if (!c.eat(')')) return kNaN;
  }
  c.spaces();
  if (!c.done()) return kNaN;
  double t = timeValue(makeDay(year, month, dayOfMonth), makeTime(h, m, s, 0));
  return timeClip(hasZone ? t - offset : utcFromLocal(t));
}

}  // namespace

DateObject::DateObject(double t) : t_(timeClip(t)) {}

double DateObject::setTime(double t) { return t_ = timeClip(t); }

#define LUCENT_LOCAL(fn, expr)                   \
  double DateObject::fn() const {                \
    if (std::isnan(t_)) return kNaN;             \
    double t = localTime(t_);                    \
    return expr;                                 \
  }
#define LUCENT_UTC(fn, expr)                     \
  double DateObject::fn() const {                \
    if (std::isnan(t_)) return kNaN;             \
    double t = t_;                               \
    return expr;                                 \
  }
LUCENT_LOCAL(getFullYear, yearFromTime(t))
LUCENT_LOCAL(getMonth, monthFromTime(t))
LUCENT_LOCAL(getDate, dateFromTime(t))
LUCENT_LOCAL(getDay, weekDay(t))
LUCENT_LOCAL(getHours, hourFromTime(t))
LUCENT_LOCAL(getMinutes, minFromTime(t))
LUCENT_LOCAL(getSeconds, secFromTime(t))
LUCENT_LOCAL(getMilliseconds, msFromTime(t))
LUCENT_UTC(getUTCFullYear, yearFromTime(t))
LUCENT_UTC(getUTCMonth, monthFromTime(t))
LUCENT_UTC(getUTCDate, dateFromTime(t))
LUCENT_UTC(getUTCDay, weekDay(t))
LUCENT_UTC(getUTCHours, hourFromTime(t))
LUCENT_UTC(getUTCMinutes, minFromTime(t))
LUCENT_UTC(getUTCSeconds, secFromTime(t))
LUCENT_UTC(getUTCMilliseconds, msFromTime(t))
#undef LUCENT_LOCAL
#undef LUCENT_UTC

double DateObject::getTimezoneOffset() const {
  if (std::isnan(t_)) return kNaN;
  return (t_ - localTime(t_)) / kMsPerMinute;
}

double DateObject::setLocal(bool utc, double date, double time) {
  double v = timeValue(date, time);
  return t_ = timeClip(utc ? v : utcFromLocal(v));
}

// Each setter reads the current fields in local time (or UTC), replaces the
// given ones and recomputes the time value.
#define LUCENT_SETTERS(Prefix, utc, now)                                                                                   \
  double DateObject::set##Prefix##FullYear(double y, Opt<double> m, Opt<double> d) {                                     \
    double t = std::isnan(t_) ? 0 : now;                                                                                   \
    return setLocal(utc, makeDay(y, m.has() ? m.get() : monthFromTime(t), d.has() ? d.get() : dateFromTime(t)), timeWithinDay(t)); \
  }                                                                                                                        \
  double DateObject::set##Prefix##Month(double m, Opt<double> d) {                                                       \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, makeDay(yearFromTime(t), m, d.has() ? d.get() : dateFromTime(t)), timeWithinDay(t));           \
  }                                                                                                                        \
  double DateObject::set##Prefix##Date(double d) {                                                                       \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, makeDay(yearFromTime(t), monthFromTime(t), d), timeWithinDay(t));                               \
  }                                                                                                                        \
  double DateObject::set##Prefix##Hours(double h, Opt<double> m, Opt<double> s, Opt<double> ms) {                        \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, day(t), makeTime(h, m.has() ? m.get() : minFromTime(t), s.has() ? s.get() : secFromTime(t), ms.has() ? ms.get() : msFromTime(t))); \
  }                                                                                                                        \
  double DateObject::set##Prefix##Minutes(double m, Opt<double> s, Opt<double> ms) {                                     \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, day(t), makeTime(hourFromTime(t), m, s.has() ? s.get() : secFromTime(t), ms.has() ? ms.get() : msFromTime(t))); \
  }                                                                                                                        \
  double DateObject::set##Prefix##Seconds(double s, Opt<double> ms) {                                                    \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, day(t), makeTime(hourFromTime(t), minFromTime(t), s, ms.has() ? ms.get() : msFromTime(t)));    \
  }                                                                                                                        \
  double DateObject::set##Prefix##Milliseconds(double ms) {                                                              \
    if (std::isnan(t_)) return kNaN;                                                                                       \
    double t = now;                                                                                                        \
    return setLocal(utc, day(t), makeTime(hourFromTime(t), minFromTime(t), secFromTime(t), ms));                         \
  }
LUCENT_SETTERS(, false, localTime(t_))
LUCENT_SETTERS(UTC, true, t_)
#undef LUCENT_SETTERS

String DateObject::toISOString() const {
  if (std::isnan(t_)) throwRangeError("Invalid time value");
  double y = yearFromTime(t_);
  std::string year = (y >= 0 && y <= 9999) ? pad(y, 4) : (y < 0 ? "-" : "+") + pad(std::fabs(y), 6);
  return String::fromLatin1(year + "-" + pad(monthFromTime(t_) + 1, 2) + "-" + pad(dateFromTime(t_), 2) + "T" + timePart(t_) + "." + pad(msFromTime(t_), 3) + "Z");
}

String DateObject::toString() const {
  if (std::isnan(t_)) return String::fromLatin1("Invalid Date");
  double lt = localTime(t_);
  return String::fromLatin1(datePart(lt) + " " + timePart(lt) + " " + offsetString(lt - t_));
}

String DateObject::toDateString() const {
  if (std::isnan(t_)) return String::fromLatin1("Invalid Date");
  return String::fromLatin1(datePart(localTime(t_)));
}

String DateObject::toTimeString() const {
  if (std::isnan(t_)) return String::fromLatin1("Invalid Date");
  double lt = localTime(t_);
  return String::fromLatin1(timePart(lt) + " " + offsetString(lt - t_));
}

String DateObject::toUTCString() const {
  if (std::isnan(t_)) return String::fromLatin1("Invalid Date");
  return String::fromLatin1(std::string(kDays[static_cast<int>(weekDay(t_))]) + ", " + pad(dateFromTime(t_), 2) + " " + kMonths[static_cast<int>(monthFromTime(t_))] + " " +
                            yearString(yearFromTime(t_)) + " " + timePart(t_) + " GMT");
}

Date makeDate(double t) { return std::make_shared<DateObject>(t); }

static double fullYear(double y) {
  double yi = std::trunc(y);
  return std::isfinite(y) && yi >= 0 && yi <= 99 ? 1900 + yi : y;
}

Date dateFromLocal(double y, double m, double d, double h, double mi, double s, double ms) {
  double t = timeValue(makeDay(fullYear(y), m, d), makeTime(h, mi, s, ms));
  return makeDate(utcFromLocal(t));
}

double dateUTC(double y, double m, double d, double h, double mi, double s, double ms) {
  return timeClip(timeValue(makeDay(fullYear(y), m, d), makeTime(h, mi, s, ms)));
}

double dateParse(const String& s) {
  std::string text = s.toUtf8();
  double t = parseIso(text);
  return std::isnan(t) ? parseLegacy(text) : t;
}

}  // namespace lucent
