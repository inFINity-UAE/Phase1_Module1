"""Project the Hijri UAE public holidays for the public_holidays seed.

[feature-spec-1_1_D.md D-14 / §3.1b] Cabinet Resolution No. (27) of 2024
Article 1 fixes five of the seven UAE public holidays on the Hijri calendar,
and u.ae states they are "determined according to moon sighting" — there is
no official machine-readable feed. This projects them so the seed has a
defensible baseline; every date it emits is stored as PROVISIONAL and is
expected to move by up to a day once announced.

Run it to regenerate the §3.1b seed table and re-check the projection against
the published actuals:  python scripts/hijri_holiday_projection.py
"""

import datetime
import math

# Meeus, Astronomical Algorithms ch. 49 — mean new moon plus the periodic
# corrections. Planetary terms (A1..A14, together < 0.001 day) are omitted:
# they are two orders of magnitude below the +-1 day moon-sighting spread
# this projection already carries.
# ponytail: accurate to ~minutes, which is far past what a PROVISIONAL date
# needs. Replace with an ephemeris library only if seeds ever go CONFIRMED.


def new_moon_jde(k: int) -> float:
    """Julian Ephemeris Day of new moon number `k` (k=0 is 2000 Jan 6)."""
    t = k / 1236.85
    jde = (2451550.09766 + 29.530588861 * k + 0.00015437 * t**2
           - 0.000000150 * t**3 + 0.00000000073 * t**4)
    e = 1 - 0.002516 * t - 0.0000074 * t**2
    rad = math.radians
    m = rad(2.5534 + 29.10535670 * k - 0.0000014 * t**2 - 0.00000011 * t**3)
    mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * t**2
             + 0.00001238 * t**3 - 0.000000058 * t**4)
    f = rad(160.7108 + 390.67050284 * k - 0.0016118 * t**2
            - 0.00000227 * t**3 + 0.000000011 * t**4)
    om = rad(124.7746 - 1.56375588 * k + 0.0020672 * t**2 + 0.00000215 * t**3)
    s = math.sin
    jde += (-0.40720 * s(mp) + 0.17241 * e * s(m) + 0.01608 * s(2 * mp)
            + 0.01039 * s(2 * f) + 0.00739 * e * s(mp - m)
            - 0.00514 * e * s(mp + m) + 0.00208 * e * e * s(2 * m)
            - 0.00111 * s(mp - 2 * f) - 0.00057 * s(mp + 2 * f)
            + 0.00056 * e * s(2 * mp + m) - 0.00042 * s(3 * mp)
            + 0.00042 * e * s(m + 2 * f) + 0.00038 * e * s(m - 2 * f)
            - 0.00024 * e * s(2 * mp - m) - 0.00017 * s(om)
            - 0.00007 * s(mp + 2 * m) + 0.00004 * s(2 * mp - 2 * f)
            + 0.00004 * s(3 * m) + 0.00003 * s(mp + m - 2 * f)
            + 0.00003 * s(2 * mp + 2 * f) - 0.00003 * s(mp + m + 2 * f)
            + 0.00003 * s(mp - m + 2 * f) - 0.00002 * s(mp - m - 2 * f)
            - 0.00002 * s(3 * mp + m) + 0.00002 * s(4 * mp))
    return jde


def jd_to_gregorian(jd: float) -> tuple[datetime.date, float]:
    """Split a Julian Day into its civil date and the fraction of day past 0h UT."""
    z = math.floor(jd + 0.5)
    frac = jd + 0.5 - z
    alpha = math.floor((z - 1867216.25) / 36524.25)
    a = z if z < 2299161 else z + 1 + alpha - math.floor(alpha / 4)
    b = a + 1524
    c = math.floor((b - 122.1) / 365.25)
    d = math.floor(365.25 * c)
    e = math.floor((b - d) / 30.6001)
    day = b - d - math.floor(30.6001 * e)
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    return datetime.date(int(year), int(month), int(day)), frac


# Anchor: lunation k=0 (2000-01-06) is the new moon of Shawwal 1420, whose
# 1st was 2000-01-08. Everything else counts months from there.
ANCHOR_MONTH_INDEX = (1420 - 1) * 12 + (10 - 1)

# Umm al-Qura criterion, approximated: the month begins the day after
# conjunction if conjunction precedes sunset at Mecca, else two days after.
MECCA_SUNSET_UT = 15.5 / 24.0


def hijri_to_gregorian(hy: int, hm: int, hd: int = 1) -> datetime.date:
    k = (hy - 1) * 12 + (hm - 1) - ANCHOR_MONTH_INDEX
    conjunction, frac = jd_to_gregorian(new_moon_jde(k))
    offset = 1 if frac < MECCA_SUNSET_UT else 2
    return conjunction + datetime.timedelta(days=offset + hd - 1)


# Cabinet Resolution 27/2024 Art. 1 — (description, Hijri month, first day, length)
HIJRI_HOLIDAYS = (
    ("Hijri New Year", 1, 1, 1),
    ("Prophet Mohammed's Birthday", 3, 12, 1),
    ("Eid Al Fitr", 10, 1, 3),
    ("Arafah Day", 12, 9, 1),
    ("Eid Al Adha", 12, 10, 3),
)

# Published actuals, used to keep the projection honest. 1 Muharram 1448 is
# included precisely because it is the one that misses, by a single day.
CALIBRATION = {
    (1420, 10, 1): datetime.date(2000, 1, 8),    # Eid Al Fitr 2000
    (1447, 9, 1): datetime.date(2026, 2, 18),    # Ramadan 2026
    (1447, 10, 1): datetime.date(2026, 3, 20),   # Eid Al Fitr 2026
    (1447, 12, 9): datetime.date(2026, 5, 26),   # Arafah 2026
    (1448, 1, 1): datetime.date(2026, 6, 15),    # Hijri New Year 1448
    (1448, 3, 12): datetime.date(2026, 8, 25),   # Prophet's Birthday 2026
}
MAX_ERROR_DAYS = 1


def _self_check() -> None:
    worst = 0
    for (hy, hm, hd), actual in CALIBRATION.items():
        error = abs((hijri_to_gregorian(hy, hm, hd) - actual).days)
        assert error <= MAX_ERROR_DAYS, (
            f"{hd}/{hm}/{hy} AH projected {hijri_to_gregorian(hy, hm, hd)}, "
            f"published {actual} — {error} days out, past the +-{MAX_ERROR_DAYS} "
            "day tolerance the PROVISIONAL seed assumes")
        worst = max(worst, error)
    print(f"self-check: {len(CALIBRATION)} published dates, worst miss {worst} day(s)")


if __name__ == "__main__":
    _self_check()
    print("\n-- PROVISIONAL rows for public_holidays (feature-spec-1_1_D §3.1b)")
    for hijri_year in range(1448, 1452):
        for description, month, first_day, length in HIJRI_HOLIDAYS:
            for offset in range(length):
                date = hijri_to_gregorian(hijri_year, month, first_day + offset)
                if date.year < 2027 or date.year > 2029:
                    continue  # seed window: remainder of 2026 has no Hijri holiday left
                escaped = description.replace("'", "''")
                print(f"('{date}', '{escaped}', 'PROVISIONAL', "
                      f"'Cabinet Resolution 27/2024 Art.1'),")
