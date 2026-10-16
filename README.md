# Twenty · Gym Slot Booking System

A robust, production-ready gym session booking and check-in system designed to eliminate overbooking and door arguments. Built with a full relational backend, atomic transaction locking, automated waitlist promotions, and a live reactive web interface.

## Test Credentials

The database comes pre-seeded with test data spanning multiple days, including an **in-progress live session** and a **full session with a waitlist**.

| Role | Name | Email | Password | Pre-configured State |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | Gym Admin | `admin@gym.test` | `AdminPass123` | Can create sessions, view all member bookings, and check in codes |
| **Member** | Alice Member | `alice@gym.test` | `MemberPass123` | Has a confirmed booking in today's **live session** (ready to test check-in) |
| **Member** | Bob Member | `bob@gym.test` | `MemberPass123` | Waitlisted at **Position #1** in tomorrow's 18:00 full session |
| **Member (extra)** | Priya Shah | `priya.shah@gym.test` | `MemberPass123` | General member |

*(Quick-login buttons for Admin, Alice, and Bob are also built directly into the login screen).*


