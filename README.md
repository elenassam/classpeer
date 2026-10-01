# 발표 상호평가 웹앱

중학교 영어 발표 수업용 동료평가 앱입니다. 학생은 로그인 없이 링크로 들어와 평가하고, 교사는 비밀번호로 들어와 평가 기준·실시간 대시보드·학생별 점수·참여 현황·피드백 리포트를 관리합니다.

- 앱 서버와 데이터베이스 모두 **Render** 무료 요금제 (GitHub 저장소와 연결해 자동 배포)

> Render 무료 데이터베이스(Postgres)는 **만든 지 30일 뒤 만료**됩니다. 만료되면 데이터가 사라지니, 남겨야 할 결과는 그 전에 따로 기록해 두세요. 30일마다 새 데이터베이스를 만드는 방법은 아래에 있어요.

---

## 1단계. GitHub에 올리기

1. https://github.com 에 로그인 → 오른쪽 위 **+ → New repository**
2. Repository name: `peer-review-app` (아무 이름 가능) · **Private** 선택 → **Create repository**
3. 새 저장소 화면에서 **uploading an existing file** 링크를 누릅니다.
4. 압축을 푼 폴더 안의 내용(`server.js`, `package.json`, `render.yaml`, `README.md`, `.gitignore`, **`public` 폴더**)을 모두 끌어다 놓습니다.
   - `public` 폴더는 폴더째로 끌어다 놓아야 `public/index.html` 경로가 유지돼요.
   - `.gitignore`는 숨김 파일이라 안 보일 수 있는데, 없어도 동작합니다.
5. 아래 **Commit changes**를 누릅니다.

## 2단계. Render에 배포하기 (Blueprint)

저장소 안의 `render.yaml` 덕분에 **서버와 데이터베이스가 한 번에** 만들어지고 자동으로 연결돼요.

1. https://render.com 에서 **GitHub 계정으로 가입/로그인**합니다.
2. 오른쪽 위 **New + → Blueprint** → GitHub 연결을 허용하고, 1단계에서 만든 저장소를 고릅니다.
3. Blueprint Name은 아무거나 적고, `TEACHER_PASSWORD` 칸에 **선생님만 아는 교사용 비밀번호**를 적습니다.
4. **Deploy Blueprint**(또는 Apply)를 누릅니다.
   - `peer-review-db`(데이터베이스)와 `peer-review-app`(웹앱)이 함께 만들어져요.
5. 몇 분 뒤 대시보드에서 `peer-review-app`을 누르면 `https://peer-review-app-xxxx.onrender.com` 같은 주소가 보여요. 완료!
   - Logs에 `[store] Postgres 연결됨`이 보이면 정상입니다.

> 무료 데이터베이스는 작업 공간(workspace)마다 하나만 만들 수 있어요. 이미 다른 무료 DB가 있으면 그것을 지운 뒤 진행하세요.

## 30일 뒤 데이터베이스가 만료되면

1. Render 대시보드에서 만료된 `peer-review-db`를 **삭제**합니다. (Settings 맨 아래 Delete Database)
2. **Blueprints → (내 Blueprint) → Manual Sync**를 누르면 `render.yaml`대로 새 데이터베이스가 만들어지고 웹앱에 다시 연결됩니다.
3. 앱 주소는 그대로이고, 반·평가 기준 등은 처음부터 다시 만들면 됩니다.

> 매번 다시 만들기 번거롭다면, 데이터베이스만 유료(월 몇 달러)로 바꾸거나 무료로 계속 유지되는 MongoDB Atlas를 쓸 수도 있어요.

## 사용하기

- 주소를 열면 첫 화면에서 **교사 / 학생**을 고릅니다.
- **선생님**: '교사' → 비밀번호 입력. (주소 끝에 `?mode=teacher`를 붙이면 바로 로그인 화면)
- **학생**: 반 화면 위쪽 **학생용 링크 복사**로 받은 링크를 보내 주세요. 학생은 로그인 없이 바로 그 반으로 들어옵니다.

## 알아 두면 좋은 점

- **처음 접속이 느릴 수 있어요**: Render 무료 서버는 15분 동안 아무도 접속하지 않으면 잠들고, 다시 깨어나는 데 1분 정도 걸립니다. 수업 시작 전에 선생님이 한 번 열어 두면 학생들은 빠르게 들어올 수 있어요.
- **학생 기록은 기기(브라우저)에 연결돼요**: 한 기기를 여러 학생이 같이 쓰면 다음 학생은 반 화면의 **다른 학생으로 바꾸기**를 누르세요. 같은 학생이 다른 기기로 들어와도 번호를 같게 적으면 교사 화면에서는 한 학생으로 합쳐집니다.
- 화면은 몇 초마다 자동으로 새로 고쳐집니다(교사 약 4초, 학생 약 10초).
- **수정·업데이트**: GitHub에서 파일을 고치고 Commit하면 Render가 자동으로 다시 배포합니다. 데이터는 데이터베이스에 있어서 그대로 남아요.
- **비밀번호 변경**: Render → 서비스 → Environment에서 `TEACHER_PASSWORD`를 바꾸면 됩니다. 바꾸면 기존 교사 로그인은 풀려요.
- 이 버전에는 AI 요약 기능이 없습니다. 리포트 피드백은 대시보드의 의견을 보고 직접 적어 주세요.

## 직접 실행해 보기 (선택)

```bash
npm install
TEACHER_PASSWORD=비밀번호 npm start   # http://localhost:3000
```
`DATABASE_URL`이 없으면 `data.json` 파일에 저장합니다(내 컴퓨터에서 시험할 때만 쓰세요). Render에서 데이터베이스 없이 돌리면 서버가 잠들 때(15분 동안 접속 없음)마다 데이터가 지워져요.
