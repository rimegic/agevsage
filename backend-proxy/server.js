// 1. 필요한 패키지 가져오기
require('dotenv').config(); // .env 파일의 환경 변수를 로드
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path'); // 1. path 모듈 추가

// 2. Express 앱 초기화
const app = express();
const PORT = process.env.PORT || 3000; // 서버 포트 설정

// 3. 미들웨어 설정
app.use(cors()); // CORS 허용
app.use(express.json()); // 요청 본문을 JSON으로 파싱

// 4. 정적 파일 제공 설정 (가장 중요한 부분)
// 현재 폴더(backend-proxy)의 부모 폴더(g/010)에 있는 파일들을 웹에서 접근 가능하게 만듭니다.
app.use(express.static(path.join(__dirname, '..')));

// 5. 프록시 API 엔드포인트 정의
app.post('/api/generate', async (req, res) => {
    try {
        // 프론트엔드에서 보낸 'prompt'를 받음
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // 서버의 환경 변수에서 안전하게 API 키를 가져옴
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key is not configured on the server.' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        // Google API에 보낼 데이터 구성
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            // API 응답을 더 일관성 있게 만들기 위한 설정 추가
            generationConfig: {
                temperature: 0.4, // 창의성(무작위성)을 낮춰 일관된 JSON 응답 유도
                topK: 1,
                topP: 1,
                maxOutputTokens: 2048,
            },
            // 안전 설정: 유해 콘텐츠 차단 수준을 명시적으로 설정
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

        // 5. Axios를 사용해 Google API에 요청 전송
        const googleResponse = await axios.post(apiUrl, payload);

        // 6. Google API의 응답을 프론트엔드로 다시 전송
        res.json(googleResponse.data);

    } catch (error) {
        const errorMsg = error.response?.data?.error?.message || 'Failed to fetch from Google API';
        console.error('Proxy Server Error:', errorMsg);
        res.status(error.response?.status || 500).json({ error: errorMsg });
    }
});

// 6. 서버 실행
app.listen(PORT, () => {
    console.log(`서버가 시작되었습니다. 브라우저에서 http://localhost:${PORT} 주소로 접속하세요.`);
});