// Lucent runtime — Date.
//
// A Date is a shared, mutable time value (milliseconds since the epoch, NaN
// when invalid), with the ECMAScript algorithms for calendar fields. Local
// time comes from the C library's time zone database (localtime_r), like
// Hermes. String forms follow Hermes: toString() has no zone name.
#pragma once

#include "core.h"
#include "jsstring.h"

namespace lucent {

class DateObject : public Object {
 public:
  explicit DateObject(double t);

  double getTime() const { return t_; }
  double valueOf() const { return t_; }
  double setTime(double t);

  double getFullYear() const;
  double getMonth() const;
  double getDate() const;
  double getDay() const;
  double getHours() const;
  double getMinutes() const;
  double getSeconds() const;
  double getMilliseconds() const;
  double getTimezoneOffset() const;
  double getUTCFullYear() const;
  double getUTCMonth() const;
  double getUTCDate() const;
  double getUTCDay() const;
  double getUTCHours() const;
  double getUTCMinutes() const;
  double getUTCSeconds() const;
  double getUTCMilliseconds() const;

  // Setters return the new time value. Optional arguments keep the current field.
  double setFullYear(double y, Opt<double> m = undefined, Opt<double> d = undefined);
  double setMonth(double m, Opt<double> d = undefined);
  double setDate(double d);
  double setHours(double h, Opt<double> m = undefined, Opt<double> s = undefined, Opt<double> ms = undefined);
  double setMinutes(double m, Opt<double> s = undefined, Opt<double> ms = undefined);
  double setSeconds(double s, Opt<double> ms = undefined);
  double setMilliseconds(double ms);
  double setUTCFullYear(double y, Opt<double> m = undefined, Opt<double> d = undefined);
  double setUTCMonth(double m, Opt<double> d = undefined);
  double setUTCDate(double d);
  double setUTCHours(double h, Opt<double> m = undefined, Opt<double> s = undefined, Opt<double> ms = undefined);
  double setUTCMinutes(double m, Opt<double> s = undefined, Opt<double> ms = undefined);
  double setUTCSeconds(double s, Opt<double> ms = undefined);
  double setUTCMilliseconds(double ms);

  /// Throws RangeError for an invalid date.
  String toISOString() const;
  String toString() const;
  String toDateString() const;
  String toTimeString() const;
  String toUTCString() const;

 private:
  double setLocal(bool utc, double date, double time);
  double t_;
};
using Date = Ref<DateObject>;

/// `new Date(t)`: the time value is clipped (NaN beyond ±8.64e15).
Date makeDate(double t);
/// `new Date(y, m, d, h, mi, s, ms)` in local time (years 0–99 mean 1900–1999).
Date dateFromLocal(double y, double m, double d = 1, double h = 0, double mi = 0, double s = 0, double ms = 0);
/// `Date.UTC(y, m, d, h, mi, s, ms)`.
double dateUTC(double y, double m = 0, double d = 1, double h = 0, double mi = 0, double s = 0, double ms = 0);
/// `Date.parse(s)`: ISO 8601 (date-only forms are UTC, date-times without an
/// offset are local) and the formats toString / toUTCString produce; NaN otherwise.
double dateParse(const String& s);
inline Date dateFromString(const String& s) { return makeDate(dateParse(s)); }

inline String toJsString(const Date& d) { return d->toString(); }

}  // namespace lucent
