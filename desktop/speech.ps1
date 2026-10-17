param([switch]$Probe, [switch]$CompileCheck)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
if ($Probe) {
  $available = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' })
  if (-not $available.Count) { throw 'No Windows en-US speech recognizer is installed.' }
  Write-Output 'Windows en-US speech recognizer available; microphone was not opened.'
  exit 0
}
Add-Type -AssemblyName System.Web.Extensions
$source = @'
using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public static class JarvisSpeech {
  static readonly object Gate = new object();
  static void Emit(string type, string text) {
    lock (Gate) {
      Console.WriteLine(new JavaScriptSerializer().Serialize(new { type = type, text = text }));
      Console.Out.Flush();
    }
  }
  public static void Run() {
    try {
      using (var engine = new SpeechRecognitionEngine(new CultureInfo("en-US")))
      using (var done = new ManualResetEvent(false)) {
        engine.LoadGrammar(new DictationGrammar());
        engine.SetInputToDefaultAudioDevice();
        engine.InitialSilenceTimeout = TimeSpan.FromSeconds(60);
        engine.BabbleTimeout = TimeSpan.FromSeconds(5);
        engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(250);
        engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(400);
        engine.SpeechRecognized += (s,e) => { if (!string.IsNullOrWhiteSpace(e.Result.Text)) Emit("final", e.Result.Text); };
        engine.SpeechHypothesized += (s,e) => { if (!string.IsNullOrWhiteSpace(e.Result.Text)) Emit("interim", e.Result.Text); };
        engine.RecognizeCompleted += (s,e) => done.Set();
        engine.RecognizeAsync(RecognizeMode.Multiple);
        Emit("ready", "");
        var stop = Task.Factory.StartNew(() => Console.ReadLine());
        stop.Wait(TimeSpan.FromSeconds(60));
        engine.RecognizeAsyncStop();
        done.WaitOne(1400);
      }
    } catch { Emit("error", "Windows speech recognition could not start. Check Windows microphone access and the installed English speech language."); }
  }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Speech', 'System.Web.Extensions'
if ($CompileCheck) { Write-Output 'Windows speech helper compiled; microphone was not opened.'; exit 0 }
[JarvisSpeech]::Run()
