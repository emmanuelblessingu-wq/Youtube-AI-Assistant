import { useState } from 'react';
import './YouTubeDownload.css';

export default function YouTubeDownload({ onDataDownloaded }) {
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const YOUTUBE_API_KEY = process.env.REACT_APP_YOUTUBE_API_KEY || '';

  const getChannelId = async (url) => {
    // Try channel handle format: @channelname
    const handleMatch = url.match(/@([\w.-]+)/);
    if (handleMatch) {
      const handle = handleMatch[1];
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handle}&key=${YOUTUBE_API_KEY}`
      );
      const data = await res.json();
      
      // Check for API errors
      if (data.error) {
        const errorMsg = data.error.message || 'YouTube API error';
        throw new Error(`YouTube API error: ${errorMsg}`);
      }
      
      if (data.items?.length) return data.items[0].id;
      throw new Error('Channel not found for handle: @' + handle);
    }
    
    // Try channel ID format: /channel/CHANNEL_ID
    const channelIdMatch = url.match(/\/channel\/([\w-]+)/);
    if (channelIdMatch) return channelIdMatch[1];
    
    // Try video URL format: extract video ID and get channel from video
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (videoIdMatch) {
      const videoId = videoIdMatch[1];
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`
      );
      const data = await res.json();
      
      // Check for API errors
      if (data.error) {
        const errorMsg = data.error.message || 'YouTube API error';
        throw new Error(`YouTube API error: ${errorMsg}`);
      }
      
      if (data.items?.length && data.items[0].snippet?.channelId) {
        return data.items[0].snippet.channelId;
      }
      
      // More specific error message
      if (data.items?.length === 0) {
        throw new Error('Video not found. Please check the video URL is correct.');
      }
      
      throw new Error('Could not find channel for this video. The video may be private or unavailable.');
    }
    
    throw new Error('Could not parse channel URL. Use https://www.youtube.com/@channelname, https://www.youtube.com/channel/CHANNEL_ID, or a video URL from the channel.');
  };

  const handleDownload = async () => {
    if (!channelUrl.trim()) { setError('Please enter a YouTube channel URL'); return; }
    if (!YOUTUBE_API_KEY) { setError('REACT_APP_YOUTUBE_API_KEY is not set in .env'); return; }

    setError('');
    setLoading(true);
    setProgress(5);
    setProgressMsg('Resolving channel…');
    setResult(null);

    try {
      const maxCount = Math.min(Math.max(1, parseInt(maxVideos)), 100);

      // Step 1: get channel ID
      const channelId = await getChannelId(channelUrl.trim());
      setProgress(15);
      setProgressMsg('Fetching channel info…');

      // Step 2: get uploads playlist + channel name
      const chRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
      );
      const chData = await chRes.json();
      if (!chData.items?.length) throw new Error('Channel not found');
      const channelName = chData.items[0].snippet.title;
      const uploadsPlaylistId = chData.items[0].contentDetails.relatedPlaylists.uploads;
      setProgress(25);
      setProgressMsg(`Found channel: ${channelName}. Fetching video list…`);

      // Step 3: collect video IDs
      const videoIds = [];
      let nextPageToken = '';
      while (videoIds.length < maxCount) {
        const pageSize = Math.min(50, maxCount - videoIds.length);
        let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=${pageSize}&key=${YOUTUBE_API_KEY}`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;
        const plRes = await fetch(url);
        const plData = await plRes.json();
        if (!plData.items) break;
        plData.items.forEach((item) => videoIds.push(item.contentDetails.videoId));
        nextPageToken = plData.nextPageToken || '';
        if (!nextPageToken) break;
      }
      setProgress(50);
      setProgressMsg(`Got ${videoIds.length} video IDs. Fetching metadata…`);

      // Step 4: get video details in batches of 50
      const videos = [];
      for (let i = 0; i < videoIds.length; i += 50) {
        const batch = videoIds.slice(i, i + 50);
        const vRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&key=${YOUTUBE_API_KEY}`
        );
        const vData = await vRes.json();
        if (vData.items) {
          vData.items.forEach((video) => {
            const dur = video.contentDetails.duration;
            const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            const seconds = (parseInt(m?.[1] || 0) * 3600) + (parseInt(m?.[2] || 0) * 60) + parseInt(m?.[3] || 0);
            videos.push({
              video_id: video.id,
              title: video.snippet.title,
              description: video.snippet.description,
              transcript: '',
              duration: seconds,
              release_date: video.snippet.publishedAt,
              view_count: parseInt(video.statistics.viewCount || 0),
              like_count: parseInt(video.statistics.likeCount || 0),
              comment_count: parseInt(video.statistics.commentCount || 0),
              video_url: `https://www.youtube.com/watch?v=${video.id}`,
              thumbnail_url: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url || '',
            });
          });
        }
        setProgress(50 + Math.round(((i + 50) / videoIds.length) * 40));
        setProgressMsg(`Downloaded ${Math.min(i + 50, videoIds.length)} / ${videoIds.length} videos…`);
      }

      const channelData = {
        channel_name: channelName,
        channel_url: channelUrl.trim(),
        channel_id: channelId,
        downloaded_at: new Date().toISOString(),
        video_count: videos.length,
        videos,
      };

      setProgress(100);
      setProgressMsg('Done!');
      setResult({ channelName, videoCount: videos.length, data: channelData });

      // Notify parent so it can be used in chat
      if (onDataDownloaded) onDataDownloaded(channelData);

      // Automatically trigger download
      const filename = `${channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_channel_data.json`;
      const blob = new Blob([JSON.stringify(channelData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save JSON file to public folder via server (best-effort)
      try {
        await fetch('/api/save-json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, data: channelData }),
        });
        setResult((r) => ({ ...r, filename }));
      } catch {
        // server save is best-effort
      }
    } catch (err) {
      setError(err.message || 'Failed to download channel data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="yt-download">
      <div className="yt-download-card">
        <h2 className="yt-title">YouTube Channel Download</h2>
        <p className="yt-subtitle">Download video metadata for AI analysis</p>

        <div className="yt-field">
          <label>Channel URL</label>
          <input
            type="url"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            placeholder="https://www.youtube.com/@veritasium"
            disabled={loading}
          />
        </div>

        <div className="yt-field">
          <label>
            Max Videos: <strong>{maxVideos}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={100}
            value={maxVideos}
            onChange={(e) => setMaxVideos(parseInt(e.target.value))}
            disabled={loading}
            className="yt-slider"
          />
          <div className="yt-slider-labels">
            <span>1</span><span>Default: 10</span><span>100</span>
          </div>
        </div>

        {error && <div className="yt-error">{error}</div>}

        {loading && (
          <div className="yt-progress-wrap">
            <div className="yt-progress-bar-track">
              <div className="yt-progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="yt-progress-msg">{progressMsg} ({progress}%)</p>
          </div>
        )}

        <button
          className="yt-btn"
          onClick={handleDownload}
          disabled={loading}
        >
          {loading ? 'Downloading…' : '⬇ Download Channel Data'}
        </button>

        {result && (
          <div className="yt-result">
            <p className="yt-result-title">✓ Download complete!</p>
            <p className="yt-result-info">
              <strong>{result.channelName}</strong> — {result.videoCount} videos loaded into chat context.
            </p>
            <button
              className="yt-save-btn"
              onClick={() => {
                const filename = `${result.channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_channel_data.json`;
                const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
            >
              💾 Download JSON Again
            </button>
            <div className="yt-preview">
              {result.data.videos.slice(0, 5).map((v, i) => (
                <div key={v.video_id} className="yt-preview-item">
                  <span className="yt-preview-num">{i + 1}</span>
                  {v.thumbnail_url && <img src={v.thumbnail_url} alt="" className="yt-preview-thumb" />}
                  <div className="yt-preview-info">
                    <span className="yt-preview-title">{v.title}</span>
                    <span className="yt-preview-meta">
                      {(v.view_count / 1e6).toFixed(1)}M views · {new Date(v.release_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
              {result.data.videos.length > 5 && (
                <p className="yt-preview-more">+{result.data.videos.length - 5} more videos</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
