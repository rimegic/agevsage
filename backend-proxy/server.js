
// 1. 필요한 패키지 가져오기
require('dotenv').config(); // .env 파일의 환경 변수를 로드
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

// 2. Express 앱 초기화
const app = express();
const PORT = process.env.PORT || 3000;

// 3. 미들웨어 설정
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1); // 프록시 뒤에 있는 경우 실제 IP를 가져오기 위해 필요

// 4. 정적 파일 제공 설정
app.use(express.static(path.join(__dirname, '..')));

// 5. IP 기반 API 호출 제한을 위한 인메모리 데이터베이스
const apiUsage = {};
const MAX_REQUESTS_PER_DAY = 20;

// 6. API 호출 제한 미들웨어
const rateLimiter = (req, res, next) => {
    const ip = req.ip;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 형식

    if (!apiUsage[ip]) {
        apiUsage[ip] = { count: 0, date: today };
    }

    // 날짜가 바뀌면 카운트 초기화
    if (apiUsage[ip].date !== today) {
        apiUsage[ip] = { count: 0, date: today };
    }

    if (apiUsage[ip].count >= MAX_REQUESTS_PER_DAY) {
        return res.status(429).json({ 
            error: '일일 API 사용량을 초과했습니다. 내일 다시 시도해주세요.' 
        });
    }

    apiUsage[ip].count++;
    console.log(`[API Usage] IP: ${ip}, Count: ${apiUsage[ip].count}/${MAX_REQUESTS_PER_DAY}`);
    next();
};

// 7. 프록시 API 엔드포인트 정의 (미들웨어 적용)
app.post('/api/generate', rateLimiter, async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key is not configured on the server.' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                topK: 1,
                topP: 1,
                maxOutputTokens: 2048,
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

        const googleResponse = await axios.post(apiUrl, payload);
        res.json(googleResponse.data);

    } catch (error) {
        const errorMsg = error.response?.data?.error?.message || 'Failed to fetch from Google API';
        console.error('Proxy Server Error:', errorMsg);
        res.status(error.response?.status || 500).json({ error: errorMsg });
    }
});

// 8. 서버 실행
app.listen(PORT, () => {
    console.log(`서버가 시작되었습니다. 브라우저에서 http://localhost:${PORT} 주소로 접속하세요.`);
});
