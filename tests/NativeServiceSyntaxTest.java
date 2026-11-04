// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import com.sun.source.util.JavacTask;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/** Parse-only check: deliberately does NOT type-check against invented Android APIs. */
public final class NativeServiceSyntaxTest {
    public static void main(String[] paths) throws Exception {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new AssertionError("A JDK compiler is required");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, null)) {
            JavacTask task = (JavacTask) compiler.getTask(null, files, diagnostics,
                    List.of("-proc:none", "-source", "17"), null, files.getJavaFileObjects(paths));
            int parsed = 0;
            for (var ignored : task.parse()) parsed++;
            for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics())
                if (diagnostic.getKind() == Diagnostic.Kind.ERROR) throw new AssertionError(diagnostic.toString());
            if (parsed != paths.length) throw new AssertionError("Some Java sources were not parsed");
            System.out.println("PASS Java 17 syntax: " + parsed + " sources, parse-only (not Android API compilation)");
        }
    }
}
