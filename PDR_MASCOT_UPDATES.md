# UniClass PDR — Nova Mascot Updates

## 2.3 Key Features

| Feature | Description |
|---------|-------------|
| **Interactive Companion (Nova)** | Dynamic UI mascot that guides onboarding, hosts AI missions, reacts to attendance streaks, and reduces idle drop-off during waiting states. |

## 6.1.1 Mascot & Avatar Identity — Nova the Companion 🦄

- **Primary persona:** Curious, encouraging, and playful learning guide.
- **Dynamic states:** 😴 waiting approval; 🤖 professor/AI mission agent; 🎉 QR scan success; 🎰 Gacha host; 🔍 friendly error/not-found helper.
- Nova is a reusable, code-native SVG component to preserve accessibility, performance, and visual consistency at every screen size.

## 6.2 Component Library

| Component | Usage |
|---|---|
| `MascotWidget` | Reusable SVG companion with `waiting`, `excited`, `ai_thinking`, `quest`, `gacha`, and `error` states. |
| `MascotBadge` | Collectible student avatar icon with `nova`, `cyber_nova`, and `gold_crown` visual skins. |

## 6.3 Page Requirements

- **Waiting Approval:** Nova naps beside a clock; tapping it gives a playful animation while approval is polled every five seconds.
- **AI Missions:** Professor Nova wears glasses while generating missions; student missions use Nova as a quest host.
- **QR success:** Nova celebrates alongside the points reward. Invalid scans and join codes show a friendly puzzled Nova instead of only raw text.
- **Gacha:** Nova hosts the capsule draw and future rewards may unlock Nova skins/badges.

## 7.4 Future Data Schema

| Table | Purpose | Key Fields |
|---|---|---|
| `user_avatars` | Unlocked mascot skins and student badges | id, user_id, skin_key (`cyber_nova`, `gold_crown`), equipped_status |
