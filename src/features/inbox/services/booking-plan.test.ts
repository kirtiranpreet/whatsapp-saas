import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingInstruction, bookingOf, describeStart, parseBookingNotice } from "./booking-plan.ts";

test("parses the standard HighLevel workflow webhook payload", () => {
  const n = parseBookingNotice({
    contact_id: "c1",
    first_name: "Marta",
    full_name: "Marta López",
    email: "marta@example.com",
    phone: "+34 600 11 22 33",
    calendar: {
      calendarName: "ISH llamada informativa",
      startTime: "2026-10-01T10:00:00+02:00",
      selectedTimezone: "Europe/Madrid",
      appointmentId: "apt_1",
    },
  });
  assert.deepEqual(n, {
    phone: "+34 600 11 22 33",
    name: "Marta López",
    email: "marta@example.com",
    start: "2026-10-01T10:00:00+02:00",
    timeZone: "Europe/Madrid",
    calendar: "ISH llamada informativa",
    appointmentId: "apt_1",
  });
});

test("no phone, no notice", () => {
  assert.equal(parseBookingNotice({ full_name: "X" }), null);
  assert.equal(parseBookingNotice(null), null);
});

test("describes the start in Spain time", () => {
  assert.equal(
    describeStart("2026-10-01T08:00:00Z", "Europe/Madrid"),
    "jueves, 1 de octubre a las 10:00 (hora de España)",
  );
  assert.equal(describeStart("Thursday 10 AM", null), "Thursday 10 AM");
  assert.equal(describeStart(null, null), null);
});

test("meta and instruction", () => {
  assert.deepEqual(bookingOf({ booking: { start: "s", when: "w", appointment_id: null } }), {
    start: "s",
    when: "w",
    appointment_id: null,
  });
  assert.equal(bookingOf({}), null);
  assert.match(bookingInstruction("jueves 1 de octubre a las 10:00"), /para el jueves 1 de octubre/);
});
