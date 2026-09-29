// Captures the sound of ONE app (and its child processes), or of everything EXCEPT one
// app, using Windows' process-loopback capture (Windows 10 2004+ / Windows 11).
// Compiled on first use with the C# compiler that ships with Windows (no downloads).
//
//   AppLoopback.exe --pid 1234 --mode include|exclude [--rate 48000]
//
// stdout: raw little-endian float32 mono samples at --rate, as a steady real-time stream
//         (silence is filled in when the app is quiet).
// stderr: one JSON status line per event, e.g. {"ok":true,"pid":1234,"rate":48000}.
// Exits when stdin closes, so it never outlives the app that started it.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace DesktopAvatar
{
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D")]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("41D949AB-9862-444A-80F6-C261334DA5EB")]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90")]
    interface IAgileObject { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    class Activation : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int Result = -1;
        public object Client;

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            int hr;
            object client;
            op.GetActivateResult(out hr, out client);
            Result = hr;
            Client = client;
            Done.Set();
        }
    }

    static class Program
    {
        [DllImport("Mmdevapi.dll", ExactSpelling = true)]
        static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [MarshalAs(UnmanagedType.LPStruct)] Guid iid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation operation);

        const uint LOOPBACK = 0x00020000, EVENTCALLBACK = 0x00040000, AUTOCONVERTPCM = 0x80000000, SRC_DEFAULT_QUALITY = 0x08000000;
        const uint BUFFER_SILENT = 0x2;
        static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

        static void Status(string json)
        {
            try { Console.Error.WriteLine(json); Console.Error.Flush(); } catch { }
        }

        static void Fail(string where, int hr)
        {
            Status("{\"ok\":false,\"error\":\"" + where + " failed (0x" + hr.ToString("X8") + ")\"}");
            Environment.Exit(2);
        }

        [MTAThread]
        static int Main(string[] args)
        {
            int pid = 0, rate = 48000;
            bool exclude = false;
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                if (args[i] == "--pid") pid = int.Parse(args[i + 1]);
                else if (args[i] == "--mode") exclude = args[i + 1] == "exclude";
                else if (args[i] == "--rate") rate = int.Parse(args[i + 1]);
            }
            if (pid <= 0) { Status("{\"ok\":false,\"error\":\"usage: --pid N --mode include|exclude\"}"); return 1; }

            // Quit as soon as whoever started us goes away.
            var watchdog = new Thread(() =>
            {
                try { var stdin = Console.OpenStandardInput(); var b = new byte[64]; while (stdin.Read(b, 0, b.Length) > 0) { } } catch { }
                Environment.Exit(0);
            });
            watchdog.IsBackground = true;
            watchdog.Start();

            // AUDIOCLIENT_ACTIVATION_PARAMS { PROCESS_LOOPBACK, { pid, INCLUDE/EXCLUDE tree } } in a VT_BLOB PROPVARIANT.
            IntPtr parms = Marshal.AllocHGlobal(12);
            Marshal.WriteInt32(parms, 0, 1);
            Marshal.WriteInt32(parms, 4, pid);
            Marshal.WriteInt32(parms, 8, exclude ? 1 : 0);
            IntPtr pv = Marshal.AllocHGlobal(24);
            for (int i = 0; i < 24; i++) Marshal.WriteByte(pv, i, 0);
            Marshal.WriteInt16(pv, 0, 65); // VT_BLOB
            Marshal.WriteInt32(pv, 8, 12);
            Marshal.WriteIntPtr(pv, 16, parms);

            var act = new Activation();
            IActivateAudioInterfaceAsyncOperation op;
            int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", IID_IAudioClient, pv, act, out op);
            if (hr != 0) Fail("ActivateAudioInterfaceAsync", hr);
            if (!act.Done.WaitOne(5000)) { Status("{\"ok\":false,\"error\":\"activation timed out\"}"); return 3; }
            if (act.Result != 0) Fail("activation", act.Result);
            var client = (IAudioClient)act.Client;

            // 16-bit stereo PCM at the requested rate; Windows converts whatever the app plays.
            IntPtr fmt = Marshal.AllocHGlobal(20);
            Marshal.WriteInt16(fmt, 0, 1);            // WAVE_FORMAT_PCM
            Marshal.WriteInt16(fmt, 2, 2);            // channels
            Marshal.WriteInt32(fmt, 4, rate);         // samples per second
            Marshal.WriteInt32(fmt, 8, rate * 4);     // bytes per second
            Marshal.WriteInt16(fmt, 12, 4);           // block align
            Marshal.WriteInt16(fmt, 14, 16);          // bits per sample
            Marshal.WriteInt16(fmt, 16, 0);           // extra size
            hr = client.Initialize(0, LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY, 1000000, 0, fmt, IntPtr.Zero);
            if (hr != 0) Fail("Initialize", hr);
            object svc;
            hr = client.GetService(IID_IAudioCaptureClient, out svc);
            if (hr != 0) Fail("GetService", hr);
            var capture = (IAudioCaptureClient)svc;
            var ready = new AutoResetEvent(false);
            hr = client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle());
            if (hr != 0) Fail("SetEventHandle", hr);
            hr = client.Start();
            if (hr != 0) Fail("Start", hr);
            Status("{\"ok\":true,\"pid\":" + pid + ",\"mode\":\"" + (exclude ? "exclude" : "include") + "\",\"rate\":" + rate + "}");

            var stdout = Console.OpenStandardOutput();
            var mono = new float[rate]; // up to a second of float32 mono
            var outBuf = new byte[rate * 4];
            var watch = System.Diagnostics.Stopwatch.StartNew();
            long written = 0; // samples sent so far
            var pcm = new short[rate * 2 * 2];
            while (true)
            {
                ready.WaitOne(50);
                int n = 0;
                uint packet;
                while (capture.GetNextPacketSize(out packet) == 0 && packet > 0)
                {
                    IntPtr data;
                    uint frames, flags;
                    ulong devPos, qpc;
                    if (capture.GetBuffer(out data, out frames, out flags, out devPos, out qpc) != 0) break;
                    int count = Math.Min((int)frames, mono.Length - n);
                    if ((flags & BUFFER_SILENT) != 0 || data == IntPtr.Zero)
                    {
                        Array.Clear(mono, n, count);
                    }
                    else
                    {
                        Marshal.Copy(data, pcm, 0, count * 2);
                        for (int i = 0; i < count; i++) mono[n + i] = (pcm[2 * i] + pcm[2 * i + 1]) / 65536f;
                    }
                    n += count;
                    capture.ReleaseBuffer(frames);
                    if (n >= mono.Length) break;
                }
                // Nothing playing: keep the stream going in real time with silence.
                long due = watch.ElapsedMilliseconds * rate / 1000;
                if (n == 0 && due - written > rate / 10)
                {
                    n = (int)Math.Min(due - written - rate / 50, mono.Length);
                    Array.Clear(mono, 0, n);
                }
                if (n <= 0) continue;
                Buffer.BlockCopy(mono, 0, outBuf, 0, n * 4);
                try
                {
                    stdout.Write(outBuf, 0, n * 4);
                    stdout.Flush();
                }
                catch (IOException)
                {
                    return 0; // reader went away
                }
                written += n;
                // Don't let a long silence-then-burst drift the clock forever.
                if (written > due + rate) written = due;
            }
        }
    }
}
