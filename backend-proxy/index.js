
import { Router } from 'itty-router';
import axios from 'axios';

// 1. 라우터 초기화
const router = Router();

// 2. 인메모리 데이터베이스 및 캐시
const apiUsage = {}; // { ip: [timestamp1, timestamp2, ...] }
const searchCache = {}; // { query: { people: [...] } }

const MAX_REQUESTS_PER_PERIOD = 20;
const TIME_PERIOD_MS = 5 * 60 * 1000; // 5분

// 3. API 호출 제한 미들웨어 (Workers 환경에 맞게 수정)
const rateLimiter = (request, env) => {
    const ip = request.headers.get('CF-Connecting-IP');
    const now = Date.now();

    if (!apiUsage[ip]) {
        apiUsage[ip] = [];
    }

    apiUsage[ip] = apiUsage[ip].filter(timestamp => now - timestamp < TIME_PERIOD_MS);

    if (apiUsage[ip].length >= MAX_REQUESTS_PER_PERIOD) {
        return new Response(JSON.stringify({ 
            error: `5분당 API 사용량을 초과했습니다. 잠시 후 다시 시도해주세요. (최대 ${MAX_REQUESTS_PER_PERIOD}회)` 
        }), { 
            status: 429,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    apiUsage[ip].push(now);
    console.log(`[API Usage] IP: ${ip}, Count: ${apiUsage[ip].length}/${MAX_REQUESTS_PER_PERIOD} in ${TIME_PERIOD_MS / 1000 / 60} minutes`);
};

// 4. 프록시 API 엔드포인트 정의
router.post('/api/generate', async (request, env) => {
    // 미들웨어 실행
    const rateLimitResponse = rateLimiter(request, env);
    if (rateLimitResponse) {
        return rateLimitResponse;
    }

    try {
        const { prompt } = await request.json();
        if (!prompt) {
            return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const queryMatch = prompt.match(/검색할 인물: "(.*?)"/);
        const query = queryMatch ? queryMatch[1] : null;

        if (query && searchCache[query]) {
            console.log(`[Cache] Returning cached data for query: ${query}`);
            const cachedData = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({ people: searchCache[query] })
                        }]
                    }
                }]
            };
            return new Response(JSON.stringify(cachedData), { headers: { 'Content-Type': 'application/json' } });
        }

        const apiKey = env.GOOGLE_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API key is not configured on the server.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
        const responseData = googleResponse.data;

        const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            try {
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsedResponse = JSON.parse(cleanText);
                if (parsedResponse.people && query) {
                    searchCache[query] = parsedResponse.people;
                    console.log(`[Cache] Stored data for query: ${query}`);
                }
            } catch (parseError) {
                console.error('Error parsing Google API response for caching:', parseError);
            }
        }

        return new Response(JSON.stringify(responseData), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        const errorMsg = error.response?.data?.error?.message || 'Failed to fetch from Google API';
        console.error('Proxy Server Error:', errorMsg);
        return new Response(JSON.stringify({ error: errorMsg }), { status: error.response?.status || 500, headers: { 'Content-Type': 'application/json' } });
    }
});

// 5. 모든 다른 요청에 대한 404 처리
router.all('*', () => new Response('Not Found.', { status: 404 }));

// 6. Workers 진입점
export default {
    async fetch(request, env, ctx) {
        // CORS 처리를 위한 래퍼 추가
        const handle = (req, ...args) => router.handle(req, ...args)
            .then(response => {
                // 응답에 CORS 헤더 추가
                response.headers.set('Access-Control-Allow-Origin', '*');
                response.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
                response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
                return response;
            })
            .catch(err => {
                // 에러 발생 시에도 CORS 헤더와 함께 응답
                const errorResponse = new Response(err.message || 'Server Error', { status: 500 });
                errorResponse.headers.set('Access-Control-Allow-Origin', '*');
                return errorResponse;
            });
        
        // OPTIONS 요청 (pre-flight) 처리
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        return handle(request, env, ctx);
    }
};
