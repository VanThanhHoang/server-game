// Main entry point
import { facebookCommentsConfig } from './config.js';
import { commentsService } from './service.js';

async function main() {
    console.log('=== Facebook Comments Fetcher ===\n');
    console.log(`Fetching comments every 1 second with limit: ${facebookCommentsConfig.limit}\n`);

    try {
        const stopPolling = await commentsService.pollComments(
            facebookCommentsConfig,
            1000, // Poll every 1 second (1000ms)
            (comments) => {
                const timestamp = new Date().toISOString();
                console.log(`\n[${timestamp}] Received ${comments.length} comments`);

                comments.forEach((comment, index) => {
                    console.log(`\n--- Comment ${index + 1} ---`);
                    console.log(`ID: ${comment.id}`);
                    console.log(`From: ${comment.from?.name || 'Unknown'}`);
                    console.log(`User ID: ${comment.from?.id || 'N/A'}`);
                    console.log(`Message: ${comment.message || '(no message)'}`);
                    console.log(`Created: ${comment.created_time || 'N/A'}`);
                    if (comment.from?.picture?.data?.url) {
                        console.log(`Avatar: ${comment.from.picture.data.url}`);
                    }
                });

                console.log(`\n${'='.repeat(50)}`);
            },
            (error) => {
                console.error(`\n[ERROR] ${error.message}`);
            }
        );

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n\nStopping polling...');
            stopPolling();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n\nStopping polling...');
            stopPolling();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start polling:', error);
        process.exit(1);
    }
}

// Run the main function
main();
