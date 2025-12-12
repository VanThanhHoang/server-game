// facebook-comments.service.js
const axios = require('axios');

class FacebookCommentsService {
    buildUrl(config) {
        const baseUrl = `https://graph.facebook.com/${config.apiVersion}/${config.liveVideoId}/comments`;

        const params = new URLSearchParams();

        // Add required parameters
        params.append('access_token', config.accessToken);
        params.append('limit', config.limit.toString());

        // Add optional parameters
        if (config.filter) {
            params.append('filter', 'toplevel');
        }

        if (config.liveFilter) {
            params.append('live_filter', config.liveFilter);
        }

        if (config.order) {
            params.append('order', config.order);
        }

        if (config.since) {
            params.append('since', config.since);
        }

        if (config.summaryFields && config.summaryFields.length > 0) {
            params.append('summary', config.summaryFields.join(','));
        }

        if (config.fields) {
            params.append('fields', config.fields);
        }

        return `${baseUrl}?${params.toString()}`;
    }

    async fetchComments(config) {
        const url = this.buildUrl(config);

        try {
            const headers = {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'priority': 'u=0, i',
                'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
            };

            // Add cookie if provided in config
            if (config.cookie) {
                headers['cookie'] = config.cookie;
            }

            const response = await axios.get(url, {
                headers: headers,
                validateStatus: function (status) {
                    return status < 500; // Resolve only if status < 500
                }
            });

            if (response.status !== 200) {
                console.error('Facebook API Error:', response.data);
                throw new Error(
                    `Facebook API Error (${response.status}): ${response.data.error?.message || 'Unknown error'}`
                );
            }

            return response.data;
        } catch (error) {
            if (error.response) {
                console.error('Error fetching Facebook comments:', error.response.data);
            } else {
                console.error('Error fetching Facebook comments:', error.message);
            }
            throw error;
        }
    }

    // Method to poll comments continuously (best practice for live video)
    async pollComments(config, intervalMs = 5000, callback, errorCallback) {
        const pollConfig = {
            ...config,
            order: 'reverse_chronological', // Best practice for live video
        };

        const poll = async () => {
            console.log('Polling comments...');
            try {
                const response = await this.fetchComments(pollConfig);
                callback(response.data);
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown polling error');
                console.error('Polling error:', err.message);
                if (errorCallback) {
                    errorCallback(err);
                }
            }
        };

        // Initial fetch
        await poll();

        // Setup interval
        const intervalId = setInterval(poll, intervalMs);

        // Return cleanup function
        return () => {
            clearInterval(intervalId);
            console.log('Polling stopped');
        };
    }

    // Fetch next page using pagination cursor
    async fetchNextPage(nextUrl, cookie = '') {
        try {
            const headers = {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'priority': 'u=0, i',
                'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
            };

            // Add cookie if provided
            if (cookie) {
                headers['cookie'] = cookie;
            }

            const response = await axios.get(nextUrl, {
                headers: headers,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            if (response.status !== 200) {
                throw new Error(
                    `Facebook API Error (${response.status}): ${response.data.error?.message || 'Unknown error'}`
                );
            }

            return response.data;
        } catch (error) {
            console.error('Error fetching next page:', error.response?.data || error.message);
            throw error;
        }
    }

    // Fetch all comments with pagination
    async fetchAllComments(config, maxPages = 10) {
        const allComments = [];
        let currentPage = 0;
        let nextUrl;

        try {
            // First fetch
            const firstResponse = await this.fetchComments(config);
            allComments.push(...firstResponse.data);
            nextUrl = firstResponse.paging?.next;
            currentPage++;

            // Fetch remaining pages
            while (nextUrl && currentPage < maxPages) {
                const response = await this.fetchNextPage(nextUrl, config.cookie);
                allComments.push(...response.data);
                nextUrl = response.paging?.next;
                currentPage++;

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log(`Fetched ${allComments.length} comments across ${currentPage} pages`);
            return allComments;
        } catch (error) {
            console.error('Error fetching all comments:', error);
            throw error;
        }
    }
}

module.exports = { commentsService: new FacebookCommentsService() };

