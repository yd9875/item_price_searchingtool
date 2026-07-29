# item_price_searchingtool

## 최저가 검색 툴

OpenAI Responses API의 웹 검색으로 쿠팡 상품 후보를 찾고, 용량과 묶음 수량을 정규화해 단가순으로 정렬하는 로컬 웹앱입니다.

## 설정

1. `.env.example`을 참고해 프로젝트 폴더에 `.env` 파일을 만듭니다.
2. `OPENAI_API_KEY`에 OpenAI Platform API 키를 입력합니다.
3. 서버를 실행합니다.

```powershell
npm start
```

브라우저에서 `http://localhost:5173`을 엽니다.

## Fly.io 배포

실제 API 키는 Git에 커밋하지 않고 Fly Secret으로 설정합니다.

```powershell
fly secrets set OPENAI_API_KEY=...
fly deploy
```

Node가 PATH에 없다면 Codex 번들 Node로 실행할 수 있습니다.

```powershell
& 'C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

## 환경 변수

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-sol
PORT=5173
```

- `OPENAI_API_KEY`: 필수입니다. 브라우저가 아닌 서버에서만 사용됩니다.
- `OPENAI_MODEL`: 선택 항목입니다. 기본값은 `gpt-5.6-sol`입니다.
- `PORT`: 선택 항목입니다. 기본값은 `5173`입니다.

## 검색 방식

- 검색 엔진은 OpenAI Responses API의 `web_search`만 사용합니다.
- 모델은 쿠팡의 상품명, 판매가, 배송비, 용량, 수량, URL을 구조화합니다.
- 검색 결과에서 물품 종류와 묶음 구성 버튼을 자동 생성합니다.
- 부피는 100ml당, 무게는 100g당, 개수는 1개당, 길이는 1m당으로 로컬 코드가 자동 환산합니다.
- API 오류가 발생해도 가짜 검색 결과를 표시하지 않습니다.

웹 검색 결과는 쇼핑몰의 회원가, 쿠폰, 옵션 변경을 완전히 반영하지 못할 수 있습니다. 구매 전에는 연결된 원문 상품 페이지에서 최종 가격을 확인해야 합니다.
