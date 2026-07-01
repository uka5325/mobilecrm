# MobileCRM

상담회/병원 운영을 위한 모바일 우선(Mobile-first) CRM입니다. 예약·고객관리·KPI 대시보드·인보이스·커미션·감사로그를
하나의 Next.js App Router 앱에 담았습니다. 데이터는 Firestore + Cloud Storage, 인증은 Firebase Auth를 사용합니다.

아키텍처/비용 구조에 대한 심층 분석은 [`docs/ANALYSIS-2026-06.md`](docs/ANALYSIS-2026-06.md)를 참고하세요.

## 사전 준비물

- Node.js 20 이상
- Firebase 프로젝트 (Firestore / Cloud Storage / Authentication 사용)
  - **주의**: 신규 Firebase 프로젝트에서 Cloud Storage를 사용하려면 **Blaze(종량제) 플랜**이 필요합니다. Spark(무료) 플랜인 상태로는 사진/차트 업로드 기능이 동작하지 않습니다.
- `npm run test:rules` / `npm run test:api`(에뮬레이터 테스트)를 실행하려면 **Java 11 이상**(Firestore/Auth 에뮬레이터가 JVM 기반)이 필요합니다.

## Firebase 프로젝트 설정

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트를 생성합니다.
2. Firestore, Cloud Storage, Authentication(이메일/비밀번호, 필요 시 Google)을 활성화합니다.
3. 이 저장소에는 보안 규칙/인덱스 정의가 이미 포함되어 있습니다. Firebase CLI로 배포합니다.

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add   # 콘솔에서 만든 프로젝트 선택
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

   `firestore.indexes.json`에는 예약 날짜범위·인보이스 코디네이터 스코프·환자검색 등에 쓰이는 **복합 인덱스 16개**가 정의되어 있습니다. 이 인덱스를 먼저 배포하지 않으면 해당 쿼리들이 런타임에 "The query requires an index" 에러로 실패합니다(에러 메시지에 포함된 콘솔 링크로도 개별 생성 가능하지만, 위 명령으로 한 번에 배포하는 편이 안전합니다).

## 환경변수

`.env.example`을 복사해 `.env.local`을 만들고 값을 채웁니다.

```bash
cp .env.example .env.local
```

| 변수 | 구분 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 클라이언트 | Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱(웹) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 클라이언트 | 〃 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 클라이언트 | 〃 |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 클라이언트 | 〃 |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 클라이언트 | 〃 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | 클라이언트 | 〃 |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | 클라이언트 | Google Analytics 사용 시(선택) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | 서버 전용 | Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성. JSON 파일 전체 내용을 한 줄 문자열로 설정. `/api/*` 라우트(firebase-admin)에서 사용하며 **절대 클라이언트에 노출하면 안 됩니다.** |

`NEXT_PUBLIC_*` 값은 클라이언트 번들에 그대로 포함되므로 비밀값이 아닙니다. 실제 접근 통제는 `firestore.rules`와 서버 API의 `requireActiveStaff` 검증이 담당합니다.

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

http://localhost:3000 에서 확인합니다.

## 최초 admin 계정 만들기

이 앱에는 회원가입 UI가 없습니다. 신규 직원 계정은 `/api/staff/create`로 생성하는데, 이 API는 **호출자가 이미 admin이어야** 동작합니다(닭이 먼저냐 달걀이 먼저냐 문제). 따라서 최초 admin 계정은 아래처럼 수동으로 만듭니다.

1. Firebase 콘솔 > Authentication에서 이메일/비밀번호로 사용자를 1명 생성하고 UID를 복사합니다.
2. Firestore 콘솔에서 `staff` 컬렉션에 위 UID를 문서 ID로 하는 문서를 만들고 아래 필드를 채웁니다.

   ```json
   {
     "uid": "<복사한 UID>",
     "email": "admin@example.com",
     "displayName": "관리자",
     "role": "admin",
     "active": true,
     "staffCode": "",
     "orderNo": 0
   }
   ```

3. 이제 이 계정으로 로그인하면 설정 화면에서 `/api/staff/create`를 통해 나머지 직원 계정을 정상적으로 추가할 수 있습니다.

## npm 스크립트

| 스크립트 | 설명 | 사전 조건 |
|---|---|---|
| `npm run dev` | 로컬 개발 서버 실행 | - |
| `npm run build` | 프로덕션 빌드 | - |
| `npm start` | 빌드 결과 실행 | `npm run build` 선행 |
| `npm run lint` | ESLint 검사 | - |
| `npm test` | 순수 함수 단위 테스트 (`tests/units.test.ts`) | - |
| `npm run test:rules` | Firestore 보안 규칙 테스트 | Firebase CLI, Java (Firestore 에뮬레이터 자동 기동) |
| `npm run test:api` | API 라우트(`app/api/*`) 통합 테스트 | Firebase CLI, Java (Firestore+Auth 에뮬레이터 자동 기동) |

`test:rules`/`test:api`는 `firebase emulators:exec`로 에뮬레이터를 띄운 뒤 테스트를 실행하고 자동으로 종료합니다. 별도로 에뮬레이터를 미리 켜둘 필요는 없습니다.

## 배포

- **앱 호스팅**: [Vercel](https://vercel.com/)에 Next.js 앱을 배포합니다(Firebase Hosting은 사용하지 않습니다).
- **백엔드**: Firebase가 Firestore / Cloud Storage / Authentication만 담당합니다(Cloud Functions 미사용 — 서버 로직은 전부 Next.js API 라우트).
- Vercel 프로젝트 설정의 환경변수에 위 표의 값을 동일하게 등록합니다.
- CI(`.github/workflows/ci.yml`)가 lint/타입체크/단위테스트/규칙테스트/API 테스트를 push·PR마다 실행합니다.
