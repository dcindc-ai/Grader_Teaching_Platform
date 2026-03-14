# Teaching Platform

AI-assisted teaching platform for multi-course instruction. Built for Dave Cook (UMD / Wake Forest).

## Features

- **Multi-course management** — GEOG 661, AIN 714, and any future course
- **PDF Assignment Grading** — bulk upload, AI grading, calibration examples, rewrite suggestions
- **Discussion Responder** — generate personalized instructor replies in your voice
- **Student Roster** — track progress across all assignments per student
- **Teaching Corpus** — queryable history of all graded work across all courses

## Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **AI**: Anthropic Claude (claude-sonnet-4-20250514)

## Local Setup (Windows)

### Prerequisites
- Node.js v18+ (nodejs.org)
- Git (git-scm.com)

### Install

```powershell
git clone https://github.com/dcindc-ai/Grader_Teaching_Platform.git
cd Grader_Teaching_Platform
copy .env.example .env
notepad .env
```

Fill in your `ANTHROPIC_API_KEY` and `ADMIN_PASSWORD`.

### Run

```powershell
# Terminal 1 — backend
cd backend
npm install
npm run dev

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173
