Attribute VB_Name = "DfdSvgToExcel"
'
' FP DFD Editor の「すべての DFD を一括出力（ZIP）」で出力した SVG を、
' 新しいブックに機能ごとのシートとして貼り付けるマクロ（doc/excel-macro.md）。
' Windows 版 Excel（Microsoft 365・Excel 2021・Excel 2019。SVG の貼り付けに対応した版）用。
'
' 使い方: このモジュールを取り込み、マクロ「ImportDfdSvgs」を実行する。
'   ZIP ファイル、または ZIP を展開したフォルダを選ぶと、新しいブックに次のシートを作る。
'   - 「目次」: 大分類・中分類・機能名と、各シートへのリンク
'   - 機能ごとのシート: シート名は機能名（使えない文字は「_」に置き換える）。A1 に「大分類 / 中分類 / 機能名」、A3 を左上にして DFD の図（SVG のまま）
'   ZIP の index.tsv があればその順（アプリのツリーの順）に並べ、なければフォルダ・ファイル名の順に並べる。
'
Option Explicit

' 図の最大幅（ポイント）。これより大きい図は縦横比を保って縮小する
Private Const MAX_WIDTH_PT As Double = 900
Private Const TOC_SHEET As String = "目次"
Private Const INDEX_FILE As String = "index.tsv"

Private Type DfdEntry
    RelPath As String
    Category1 As String
    Category2 As String
    FeatureName As String
    SheetName As String
End Type

Public Sub ImportDfdSvgs()
#If Mac Then
    MsgBox "このマクロは Windows 版 Excel 用です。", vbExclamation
    Exit Sub
#End If
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")

    Dim src As String
    src = PickSource()
    If src = "" Then Exit Sub

    Dim root As String, tempDir As String
    If LCase$(Right$(src, 4)) = ".zip" Then
        tempDir = fso.BuildPath(Environ$("TEMP"), "dfd_svg_" & Format$(Now, "yyyymmdd_hhnnss"))
        If Not ExtractZip(src, tempDir) Then
            MsgBox "ZIP ファイルを展開できませんでした。" & vbCrLf & "エクスプローラーで展開し、展開したフォルダを選んでください。", vbExclamation
            Exit Sub
        End If
        root = tempDir
    Else
        root = src
    End If

    Dim entries() As DfdEntry, total As Long
    total = LoadEntries(fso, root, entries)
    If total = 0 Then
        MsgBox "SVG ファイルが見つかりませんでした。" & vbCrLf & root, vbExclamation
        GoTo Cleanup
    End If

    Application.ScreenUpdating = False
    Dim wb As Workbook, toc As Worksheet
    Set wb = Workbooks.Add(xlWBATWorksheet)
    Set toc = wb.Worksheets(1)
    toc.Name = TOC_SHEET

    Dim used As Object
    Set used = CreateObject("Scripting.Dictionary")
    used.CompareMode = vbTextCompare
    used.Add SheetKey(TOC_SHEET), True

    Dim renamed As String, failed As String, i As Long, ws As Worksheet
    For i = 0 To total - 1
        Set ws = wb.Worksheets.Add(After:=wb.Worksheets(wb.Worksheets.Count))
        entries(i).SheetName = NameSheet(ws, entries(i).FeatureName, used)
        If entries(i).SheetName <> entries(i).FeatureName Then
            renamed = renamed & "・" & entries(i).FeatureName & " → " & entries(i).SheetName & vbCrLf
        End If
        If Not FillSheet(ws, entries(i), fso.BuildPath(root, entries(i).RelPath)) Then
            failed = failed & "・" & entries(i).RelPath & vbCrLf
        End If
    Next i

    WriteToc toc, entries, total
    toc.Activate
    Application.ScreenUpdating = True

    Dim msg As String
    msg = total & " 件の DFD をシートに貼りました。ブックを保存してください。"
    If renamed <> "" Then msg = msg & vbCrLf & vbCrLf & "シート名の制限のため、次の名前を変えました:" & vbCrLf & renamed
    If failed <> "" Then msg = msg & vbCrLf & "次の図は貼れませんでした（SVG に対応していない版の Excel の可能性があります）:" & vbCrLf & failed
    MsgBox msg, IIf(failed = "", vbInformation, vbExclamation)

Cleanup:
    ' 図はブックに埋め込むので、展開した一時フォルダは消してよい
    If tempDir <> "" Then
        On Error Resume Next
        fso.DeleteFolder tempDir, True
        On Error GoTo 0
    End If
End Sub

' ZIP ファイルか、展開済みのフォルダを選ぶ。キャンセルなら空文字
Private Function PickSource() As String
    Select Case MsgBox("DFD の ZIP ファイルを選びますか？" & vbCrLf & vbCrLf & _
                       "［はい］ZIP ファイルを選ぶ" & vbCrLf & "［いいえ］ZIP を展開したフォルダを選ぶ", vbYesNoCancel + vbQuestion, "DFD の SVG を Excel に貼る")
        Case vbYes
            Dim f As Variant
            f = Application.GetOpenFilename("ZIP ファイル (*.zip),*.zip", , "DFD の ZIP ファイルを選択")
            If VarType(f) = vbString Then PickSource = f
        Case vbNo
            With Application.FileDialog(msoFileDialogFolderPicker)
                .Title = "ZIP を展開したフォルダを選択"
                If .Show = -1 Then PickSource = .SelectedItems(1)
            End With
    End Select
End Function

' エクスプローラーの ZIP 機能で展開する。展開が終わるまで（最大 60 秒）待つ
Private Function ExtractZip(ByVal zipPath As String, ByVal destDir As String) As Boolean
    Dim fso As Object, sh As Object, zipNs As Object, destNs As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set sh = CreateObject("Shell.Application")
    fso.CreateFolder destDir
    Set zipNs = sh.Namespace(CVar(zipPath))
    Set destNs = sh.Namespace(CVar(destDir))
    If zipNs Is Nothing Or destNs Is Nothing Then Exit Function
    ' 4: 進行状況を出さない、16: 確認に「はい」で答える
    destNs.CopyHere zipNs.Items, 4 + 16

    Dim expected As Long, deadline As Double
    expected = zipNs.Items.Count
    deadline = Timer + 60
    Do While destNs.Items.Count < expected
        If Timer > deadline Then Exit Function
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 1)
    Loop
    ' 最後のファイルの書き込みが終わるのを少し待つ
    Application.Wait Now + TimeSerial(0, 0, 1)
    ExtractZip = True
End Function

' 貼る SVG の一覧を作る。index.tsv があればそれを、なければフォルダを探す
Private Function LoadEntries(ByVal fso As Object, ByVal root As String, ByRef entries() As DfdEntry) As Long
    Dim indexPath As String
    indexPath = fso.BuildPath(root, INDEX_FILE)
    If fso.FileExists(indexPath) Then
        LoadEntries = LoadFromIndex(fso, root, indexPath, entries)
        If LoadEntries > 0 Then Exit Function
    End If

    Dim paths As Collection
    Set paths = New Collection
    CollectSvgs fso.GetFolder(root), "", paths
    If paths.Count = 0 Then Exit Function

    Dim sorted() As String, i As Long, j As Long, tmp As String
    ReDim sorted(0 To paths.Count - 1)
    For i = 1 To paths.Count
        sorted(i - 1) = paths(i)
    Next i
    For i = 1 To UBound(sorted)
        tmp = sorted(i)
        j = i - 1
        Do While j >= 0
            If StrComp(sorted(j), tmp, vbTextCompare) <= 0 Then Exit Do
            sorted(j + 1) = sorted(j)
            j = j - 1
        Loop
        sorted(j + 1) = tmp
    Next i

    ReDim entries(0 To UBound(sorted))
    Dim parts() As String, n As Long
    For i = 0 To UBound(sorted)
        parts = Split(sorted(i), "\")
        n = UBound(parts)
        entries(i).RelPath = sorted(i)
        entries(i).FeatureName = Left$(parts(n), Len(parts(n)) - 4)
        If n >= 1 Then entries(i).Category2 = parts(n - 1)
        If n >= 2 Then entries(i).Category1 = parts(n - 2)
    Next i
    LoadEntries = UBound(sorted) + 1
End Function

' index.tsv（UTF-8、タブ区切り: パス・大分類・中分類・機能名。1 行目は見出し）を読む
Private Function LoadFromIndex(ByVal fso As Object, ByVal root As String, ByVal indexPath As String, ByRef entries() As DfdEntry) As Long
    Dim stream As Object, content As String
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.LoadFromFile indexPath
    content = stream.ReadText
    stream.Close

    Dim lines() As String, cols() As String, i As Long, n As Long, rel As String
    lines = Split(Replace(content, vbCrLf, vbLf), vbLf)
    ReDim entries(0 To UBound(lines))
    For i = 1 To UBound(lines)
        cols = Split(lines(i), vbTab)
        If UBound(cols) >= 3 Then
            rel = Replace(cols(0), "/", "\")
            If fso.FileExists(fso.BuildPath(root, rel)) Then
                entries(n).RelPath = rel
                entries(n).Category1 = cols(1)
                entries(n).Category2 = cols(2)
                entries(n).FeatureName = cols(3)
                n = n + 1
            End If
        End If
    Next i
    If n > 0 Then ReDim Preserve entries(0 To n - 1)
    LoadFromIndex = n
End Function

Private Sub CollectSvgs(ByVal folder As Object, ByVal prefix As String, ByVal paths As Collection)
    Dim f As Object, child As Object
    For Each f In folder.Files
        If LCase$(Right$(f.Name, 4)) = ".svg" Then paths.Add prefix & f.Name
    Next f
    For Each child In folder.SubFolders
        CollectSvgs child, prefix & child.Name & "\", paths
    Next child
End Sub

' シート名は機能名（小分類）だけにする。使えない文字を置き換えてから付け、
' 同じ名前があるか Excel に拒否されたときは「 (2)」などを付けて付け直す
Private Function NameSheet(ByVal ws As Worksheet, ByVal featureName As String, ByVal used As Object) As String
    Dim base As String, candidate As String, suffix As String, i As Long, ok As Boolean
    base = SafeSheetName(featureName)
    candidate = base
    i = 1
    Do
        If Not used.Exists(SheetKey(candidate)) Then
            On Error Resume Next
            ws.Name = candidate
            ok = (Err.Number = 0)
            Err.Clear
            On Error GoTo 0
            If ok Then Exit Do
        End If
        i = i + 1
        If i > 999 Then
            ' 名前をどうしても付けられないときは、Excel の既定の名前のままにする
            candidate = ws.Name
            Exit Do
        End If
        suffix = " (" & i & ")"
        candidate = Left$(base, 31 - Len(suffix)) & suffix
    Loop
    used.Add SheetKey(candidate), True
    NameSheet = candidate
End Function

' Excel のシート名の制限に合わせる: 31 文字以内、\ / ? * [ ] : とその全角文字・円記号・制御文字は使えない、
' 先頭と末尾にアポストロフィーは使えない、空や「History」は使えない
Private Function SafeSheetName(ByVal featureName As String) As String
    Dim bad As Variant, base As String, i As Long
    base = featureName
    For Each bad In Array("\", "/", "?", "*", "[", "]", ":", _
                          ChrW(&HFF3C), ChrW(&HFF0F), ChrW(&HFF1F), ChrW(&HFF0A), ChrW(&HFF3B), ChrW(&HFF3D), ChrW(&HFF1A), _
                          ChrW(&HFFE5), ChrW(&HA5))
        base = Replace(base, bad, "_")
    Next bad
    For i = 0 To 31
        base = Replace(base, Chr(i), "_")
    Next i
    base = Trim$(base)
    Do While Left$(base, 1) = "'"
        base = Mid$(base, 2)
    Loop
    Do While Right$(base, 1) = "'"
        base = Left$(base, Len(base) - 1)
    Loop
    If Len(base) > 31 Then base = Left$(base, 31)
    base = Trim$(base)
    If base = "" Then base = "DFD"
    If StrComp(base, "History", vbTextCompare) = 0 Then base = base & "_"
    SafeSheetName = base
End Function

' 重複を調べるための名前。Excel は大文字と小文字、全角と半角を区別しないので、そろえてから比べる
Private Function SheetKey(ByVal sheetName As String) As String
    SheetKey = LCase$(StrConv(sheetName, vbNarrow))
End Function

' 見出しと目次へのリンクを書き、A3 を左上にして SVG を貼る。貼れなければ False
Private Function FillSheet(ByVal ws As Worksheet, ByRef e As DfdEntry, ByVal svgPath As String) As Boolean
    ws.Range("A1").Value = JoinPath(e)
    ws.Range("A1").Font.Bold = True
    ws.Range("A1").Font.Size = 14
    ws.Hyperlinks.Add Anchor:=ws.Range("A2"), Address:="", SubAddress:=SheetRef(TOC_SHEET) & "!A1", TextToDisplay:="← 目次へ"

    Dim shp As Shape
    On Error Resume Next
    Set shp = ws.Shapes.AddPicture(Filename:=svgPath, LinkToFile:=0, SaveWithDocument:=-1, _
                                   Left:=ws.Range("A3").Left, Top:=ws.Range("A3").Top, Width:=-1, Height:=-1)
    On Error GoTo 0
    If shp Is Nothing Then
        ws.Range("A4").Value = "図を貼れませんでした: " & svgPath
        Exit Function
    End If
    shp.LockAspectRatio = -1
    If shp.Width > MAX_WIDTH_PT Then shp.Width = MAX_WIDTH_PT
    shp.Name = "DFD"
    shp.AlternativeText = JoinPath(e)
    FillSheet = True
End Function

Private Sub WriteToc(ByVal toc As Worksheet, ByRef entries() As DfdEntry, ByVal total As Long)
    toc.Range("A1:C1").Value = Array("大分類", "中分類", "機能名")
    toc.Range("A1:C1").Font.Bold = True
    Dim i As Long, r As Long
    For i = 0 To total - 1
        r = i + 2
        toc.Cells(r, 1).Value = entries(i).Category1
        toc.Cells(r, 2).Value = entries(i).Category2
        toc.Hyperlinks.Add Anchor:=toc.Cells(r, 3), Address:="", SubAddress:=SheetRef(entries(i).SheetName) & "!A1", TextToDisplay:=entries(i).FeatureName
    Next i
    toc.Columns("A:C").AutoFit
End Sub

Private Function JoinPath(ByRef e As DfdEntry) As String
    JoinPath = e.FeatureName
    If e.Category2 <> "" Then JoinPath = e.Category2 & " / " & JoinPath
    If e.Category1 <> "" Then JoinPath = e.Category1 & " / " & JoinPath
End Function

' 数式・リンクで使うシート参照（'シート名'、名前の ' は '' にする）
Private Function SheetRef(ByVal sheetName As String) As String
    SheetRef = "'" & Replace(sheetName, "'", "''") & "'"
End Function
